package repository

import (
	"errors"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func SaveMedia(item model.Media) (model.Media, error) {
	db, err := DB()
	if err != nil {
		return model.Media{}, err
	}
	return item, db.Create(&item).Error
}

func GetMedia(id string) (model.Media, bool, error) {
	db, err := DB()
	if err != nil {
		return model.Media{}, false, err
	}
	item := model.Media{}
	err = db.First(&item, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Media{}, false, nil
	}
	return item, err == nil, err
}

func DeleteMedia(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.Media{}, "id = ?", id).Error
}

func ListPrivateMedia(ownerUID string) ([]model.Media, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	items := make([]model.Media, 0)
	err = db.Where("owner_uid = ?", ownerUID).
		Where("cleanup_status = ?", model.MediaCleanupActive).
		Where("expires_at IS NULL").
		Where("NOT EXISTS (SELECT 1 FROM public_images WHERE public_images.media_id = media.id)").
		Order("created_at desc").
		Find(&items).Error
	return items, err
}

func SetPrivateMediaExpiry(id, ownerUID string, expiresAt *time.Time) (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	result := db.Model(&model.Media{}).Where("id = ? AND owner_uid = ? AND cleanup_status = ?", id, ownerUID, model.MediaCleanupActive).Update("expires_at", expiresAt)
	return result.RowsAffected > 0, result.Error
}

func ListExpiredPrivateMedia(before time.Time) ([]model.Media, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	items := make([]model.Media, 0)
	err = db.Where("(cleanup_status = ? AND expires_at IS NOT NULL AND expires_at <= ?) OR (cleanup_status = ? AND (cleanup_lease_until IS NULL OR cleanup_lease_until <= ?))",
		model.MediaCleanupActive, before.UTC(), model.MediaCleanupDeleting, before.UTC()).Order("expires_at asc, id asc").Find(&items).Error
	return items, err
}

func PromoteLegacyCanvasTemporaryMedia() (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	result := db.Model(&model.Media{}).
		Where("source = ?", "canvas_temporary").
		Where("cleanup_status = ?", model.MediaCleanupActive).
		Updates(map[string]any{"source": model.MediaSourceUpload, "expires_at": nil})
	return result.RowsAffected, result.Error
}

func UpdatePrivateMedia(id, ownerUID string, title *string, folderID *string) (model.Media, bool, error) {
	db, err := DB()
	if err != nil {
		return model.Media{}, false, err
	}
	updates := map[string]any{}
	if title != nil {
		updates["title"] = *title
	}
	if folderID != nil {
		updates["folder_id"] = *folderID
	}
	if len(updates) == 0 {
		return model.Media{}, false, nil
	}
	result := db.Model(&model.Media{}).Where("id = ? AND owner_uid = ? AND cleanup_status = ?", id, ownerUID, model.MediaCleanupActive).Updates(updates)
	if result.Error != nil || result.RowsAffected == 0 {
		return model.Media{}, false, result.Error
	}
	return GetMedia(id)
}

// ClaimCanvasMediaCleanup shares the media row lock with Canvas writes. A lease
// only assigns a deletion attempt; expiry never makes deleting media usable.
func ClaimCanvasMediaCleanup(id string, current time.Time, lease time.Duration) (model.Media, bool, error) {
	db, err := DB()
	if err != nil {
		return model.Media{}, false, err
	}
	var item model.Media
	claimed := false
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&item, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		switch item.CleanupStatus {
		case model.MediaCleanupActive:
			if item.ExpiresAt == nil || item.ExpiresAt.After(current) {
				return nil
			}
		case model.MediaCleanupDeleting:
			if item.CleanupLeaseUntil != nil && item.CleanupLeaseUntil.After(current) {
				return nil
			}
		default:
			return nil
		}
		referenced, err := MediaStillReferenced(tx, item.OwnerUID, item.ID)
		if err != nil {
			return err
		}
		if referenced {
			if item.CleanupStatus == model.MediaCleanupDeleting {
				return errors.New("deleting media has a persisted reference")
			}
			return tx.Model(&model.Media{}).Where("id = ?", item.ID).Update("expires_at", nil).Error
		}
		started := current.UTC()
		if item.CleanupStartedAt == nil {
			item.CleanupStartedAt = &started
		}
		until := current.UTC().Add(lease)
		item.CleanupStatus = model.MediaCleanupDeleting
		item.CleanupClaimID = uuid.NewString()
		item.CleanupLeaseUntil = &until
		if err := tx.Model(&model.Media{}).Where("id = ?", item.ID).Updates(map[string]any{
			"cleanup_status": item.CleanupStatus, "cleanup_started_at": item.CleanupStartedAt,
			"cleanup_claim_id": item.CleanupClaimID, "cleanup_lease_until": item.CleanupLeaseUntil,
		}).Error; err != nil {
			return err
		}
		claimed = true
		return nil
	})
	if err != nil {
		return model.Media{}, false, err
	}
	return item, claimed, nil
}

func DeleteClaimedCanvasMedia(id, claimID string) (bool, error) {
	if claimID == "" {
		return false, nil
	}
	db, err := DB()
	if err != nil {
		return false, err
	}
	result := db.Where("id = ? AND cleanup_status = ? AND cleanup_claim_id = ?", id, model.MediaCleanupDeleting, claimID).Delete(&model.Media{})
	return result.RowsAffected > 0, result.Error
}
