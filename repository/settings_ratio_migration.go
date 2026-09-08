package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const explicitAspectRatiosMigration model.SettingKey = "migration.explicit-aspect-ratios.v1"

// The marker and reset commit together. Lock the settings table so concurrent
// startup or settings writes cannot race the one-time reset.
func migrateExplicitAspectRatios(database *gorm.DB) error {
	return database.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("LOCK TABLE settings IN EXCLUSIVE MODE").Error; err != nil {
			return err
		}
		var marker model.Setting
		err := tx.Where("key = ?", explicitAspectRatiosMigration).Take(&marker).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var setting model.Setting
		err = tx.Where("key = ?", model.SettingKeyAI).Take(&setting).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil {
			// Raw messages preserve unknown settings and exact decimal values.
			var root map[string]json.RawMessage
			if err := json.Unmarshal(setting.Value, &root); err != nil {
				return fmt.Errorf("decode AI settings migration: %w", err)
			}
			var providers []map[string]json.RawMessage
			if value, ok := root["providers"]; ok {
				if err := json.Unmarshal(value, &providers); err != nil {
					return err
				}
			}
			for _, provider := range providers {
				if provider == nil {
					return errors.New("invalid provider in AI settings")
				}
				provider["aspectRatios"] = json.RawMessage(`[]`)
			}
			if root != nil {
				data, err := json.Marshal(providers)
				if err != nil {
					return err
				}
				root["providers"] = data
				setting.Value, err = json.Marshal(root)
				if err != nil {
					return err
				}
				if err := tx.Model(&setting).Select("value").Updates(&setting).Error; err != nil {
					return err
				}
			}
		}
		stamp := time.Now().UTC().Format(time.RFC3339)
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Setting{Key: explicitAspectRatiosMigration, Value: json.RawMessage(`true`), CreatedAt: stamp, UpdatedAt: stamp}).Error
	})
}
