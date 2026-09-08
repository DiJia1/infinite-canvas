package repository

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const MediaLifecycleTarget = "media_lifecycle"

// Only identifiers and controlled reasons belong here, never object URLs or prompts.
type MediaLifecycleDetails struct {
	OwnerUID  string     `json:"ownerUid"`
	Source    string     `json:"source,omitempty"`
	ProjectID string     `json:"projectId,omitempty"`
	Reason    string     `json:"reason"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	ClaimID   string     `json:"claimId,omitempty"`
}

func mediaLifecycleEntry(item model.Media, actor, event, project, reason string) model.OperationLog {
	details, _ := json.Marshal(MediaLifecycleDetails{OwnerUID: item.OwnerUID, Source: string(item.Source), ProjectID: project, Reason: reason, ExpiresAt: item.ExpiresAt, ClaimID: item.CleanupClaimID})
	if actor == "" {
		actor = "system"
	}
	return model.OperationLog{ID: "media-audit-" + uuid.NewString(), ActorUID: actor, ActorName: actor, ActorRoles: []string{}, Action: "media_" + event, Status: model.OperationStatusSuccess, TargetType: MediaLifecycleTarget, TargetID: item.ID, MediaIDs: []string{item.ID}, RequestSummary: string(details), CreatedAt: time.Now().UTC()}
}

// State transitions and their audit entries commit or roll back together.
func recordMediaLifecycle(tx *gorm.DB, item model.Media, actor, event, project, reason string) error {
	entry := mediaLifecycleEntry(item, actor, event, project, reason)
	return tx.Create(&entry).Error
}

// Repeated failures are coalesced per resource, actor and reason in 30-minute buckets,
// across processes and restarts, without keeping an unbounded in-memory ID cache.
func RecordMediaLifecycleFailure(item model.Media, actor, event, reason string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	entry := mediaLifecycleEntry(item, actor, event, "", reason)
	entry.Status = model.OperationStatusFailure
	entry.ID = fmt.Sprintf("media-error-%x", sha256.Sum256([]byte(fmt.Sprintf("%s/%s/%s/%s/%d", item.ID, actor, event, reason, entry.CreatedAt.Unix()/1800))))
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&entry).Error
}
