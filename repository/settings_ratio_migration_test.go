package repository

import (
	"encoding/json"
	"github.com/basketikun/infinite-canvas/model"
	"reflect"
	"testing"
)

func TestExplicitRatiosMigrationRunsOnceAndPreservesSettings(t *testing.T) {
	cfg := newRepositoryTestConfig(t, "explicit_ratios")
	useRepositoryTestDB(t, cfg)
	database, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Where("key = ?", explicitAspectRatiosMigration).Delete(&model.Setting{}).Error; err != nil {
		t.Fatal(err)
	}
	value := json.RawMessage(`{"providers":[{"id":"image","config":{"apiKey":"test-secret","model":"test-model"},"imagePrices":[{"resolution":"1K","amount":"0.1200"}],"aspectRatios":["1:1"],"futureField":{"keep":true}},{"id":"video","videoPrices":[{"resolution":"720p","amount":"0.5"}],"aspectRatios":["16:9"]}],"imageProviderId":"image","videoProviderId":"video"}`)
	row := model.Setting{Key: model.SettingKeyAI, Value: value}
	if err := database.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateExplicitAspectRatios(database); err != nil {
		t.Fatal(err)
	}
	var got model.Setting
	if err := database.First(&got, "key = ?", model.SettingKeyAI).Error; err != nil {
		t.Fatal(err)
	}
	var before, after map[string]any
	json.Unmarshal(value, &before)
	json.Unmarshal(got.Value, &after)
	for _, p := range before["providers"].([]any) {
		p.(map[string]any)["aspectRatios"] = []any{}
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("migration changed unrelated settings or did not clear ratios")
	}
	after["providers"].([]any)[0].(map[string]any)["aspectRatios"] = []any{"5:4"}
	got.Value, _ = json.Marshal(after)
	if err := database.Save(&got).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateExplicitAspectRatios(database); err != nil {
		t.Fatal(err)
	}
	var again model.Setting
	database.First(&again, "key = ?", model.SettingKeyAI)
	if string(again.Value) != string(got.Value) {
		t.Fatal("second startup cleared newly configured ratio")
	}
}

func TestExplicitRatiosMigrationFailsClosedOnMalformedSettings(t *testing.T) {
	cfg := newRepositoryTestConfig(t, "explicit_ratios_invalid")
	useRepositoryTestDB(t, cfg)
	database, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	database.Where("key = ?", explicitAspectRatiosMigration).Delete(&model.Setting{})
	row := model.Setting{Key: model.SettingKeyAI, Value: json.RawMessage(`{"providers":"invalid"}`)}
	if err := database.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateExplicitAspectRatios(database); err == nil {
		t.Fatal("invalid data accepted")
	}
	var count int64
	database.Model(&model.Setting{}).Where("key = ?", explicitAspectRatiosMigration).Count(&count)
	if count != 0 {
		t.Fatal("failed migration marked complete")
	}
}

func TestExplicitRatiosMigrationRollsBackIfMarkerFails(t *testing.T) {
	cfg := newRepositoryTestConfig(t, "explicit_ratios_rollback")
	useRepositoryTestDB(t, cfg)
	database, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	database.Where("key = ?", explicitAspectRatiosMigration).Delete(&model.Setting{})
	row := model.Setting{Key: model.SettingKeyAI, Value: json.RawMessage(`{"providers":[{"id":"model","aspectRatios":["1:1"]}]}`)}
	if err := database.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(`ALTER TABLE settings ADD CONSTRAINT reject_ratio_marker CHECK (key <> 'migration.explicit-aspect-ratios.v1')`).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateExplicitAspectRatios(database); err == nil {
		t.Fatal("marker failure ignored")
	}
	var got model.Setting
	if err := database.First(&got, "key = ?", model.SettingKeyAI).Error; err != nil {
		t.Fatal(err)
	}
	if string(got.Value) != string(row.Value) {
		t.Fatal("reset committed without marker")
	}
}

func TestExplicitRatiosConcurrentMigration(t *testing.T) {
	cfg := newRepositoryTestConfig(t, "explicit_ratios_concurrent")
	useRepositoryTestDB(t, cfg)
	database, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	database.Where("key = ?", explicitAspectRatiosMigration).Delete(&model.Setting{})
	row := model.Setting{Key: model.SettingKeyAI, Value: json.RawMessage(`{"providers":[{"aspectRatios":["1:1"]}]}`)}
	if err := database.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	done := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() { <-start; done <- migrateExplicitAspectRatios(database) }()
	}
	close(start)
	for i := 0; i < 2; i++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	var count int64
	database.Model(&model.Setting{}).Where("key = ?", explicitAspectRatiosMigration).Count(&count)
	if count != 1 {
		t.Fatalf("markers=%d", count)
	}
}
