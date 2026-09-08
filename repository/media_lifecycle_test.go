package repository

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

func lifecycleEvents(t *testing.T, id string) []model.OperationLog {
	t.Helper()
	items, _, err := ListOperationLogs(model.OperationLogQuery{MediaID: id, PageSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func TestMediaLifecycleReferencesReplayAndDeletion(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "media_lifecycle"))
	item := model.Media{ID: "image", OwnerUID: "owner", Source: model.MediaSourceUpload, ObjectKey: "secret-key"}
	if _, err := SaveMedia(item); err != nil {
		t.Fatal(err)
	}
	doc := model.CanvasProjectDocument(`{"nodes":[{"type":"image","metadata":{"mediaId":"image"}}]}`)
	if _, _, err := CreateCanvasProject(model.CanvasProject{ID: "canvas", OwnerUID: "owner", Document: doc, Revision: 1}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := UpdateCanvasProject("owner", "canvas", 1, "", doc, ""); err != nil {
		t.Fatal(err)
	}
	if events := lifecycleEvents(t, "image"); len(events) != 2 {
		t.Fatalf("unchanged save added events: %+v", events)
	}
	for i := 0; i < 2; i++ {
		if _, accepted, _, err := UpdateCanvasProjectIdempotently("owner", "canvas", 2, "", []byte(`{}`), "2026-09-08T00:00:00Z", "req", "hash"); err != nil || !accepted {
			t.Fatalf("remove: %v", err)
		}
	}
	if events := lifecycleEvents(t, "image"); len(events) != 4 {
		t.Fatalf("replay added events: %+v", events)
	}
	claims, err := ClaimCanvasMediaCleanupBatch([]string{"image"}, time.Now().Add(6*time.Minute), time.Minute)
	if err != nil || len(claims) != 1 {
		t.Fatalf("claim: %+v %v", claims, err)
	}
	if deleted, err := DeleteClaimedCanvasMedia("image", claims[0].CleanupClaimID); err != nil || !deleted {
		t.Fatalf("delete: %v", err)
	}
	if deleted, err := DeleteClaimedCanvasMedia("image", claims[0].CleanupClaimID); err != nil || deleted {
		t.Fatalf("replay delete: %v", err)
	}
	events := lifecycleEvents(t, "image")
	if len(events) != 6 {
		t.Fatalf("events survive delete: %+v", events)
	}
	for _, e := range events {
		var d MediaLifecycleDetails
		if err := json.Unmarshal([]byte(e.RequestSummary), &d); err != nil {
			t.Fatal(err)
		}
		if e.Action == "media_reference_added" && d.ProjectID != "canvas" {
			t.Fatal("lost canvas ID")
		}
		if e.Prompt != "" || e.TargetName != "" {
			t.Fatal("unexpected content in audit")
		}
	}
}

func TestMediaLifecycleAuditFailureRollsBackDeletion(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "media_audit_rollback"))
	expiry := time.Now().Add(-time.Minute)
	if _, err := SaveMedia(model.Media{ID: "image", OwnerUID: "owner", ExpiresAt: &expiry}); err != nil {
		t.Fatal(err)
	}
	claims, err := ClaimCanvasMediaCleanupBatch([]string{"image"}, time.Now(), time.Minute)
	if err != nil || len(claims) != 1 {
		t.Fatal(err)
	}
	db, _ := DB()
	const name = "test:reject_audit"
	db.Callback().Create().Before("gorm:create").Register(name, func(tx *gorm.DB) {
		if tx.Statement.Table == "operation_logs" {
			tx.AddError(errors.New("audit unavailable"))
		}
	})
	t.Cleanup(func() { db.Callback().Create().Remove(name) })
	if _, err := DeleteClaimedCanvasMedia("image", claims[0].CleanupClaimID); err == nil {
		t.Fatal("expected audit failure")
	}
	if _, found, err := GetMedia("image"); err != nil || !found {
		t.Fatal("resource record lost without audit")
	}
}

func TestMediaLifecycleFailureDedupAndRetention(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "media_audit_retention"))
	for i := 0; i < 3; i++ {
		if err := RecordMediaLifecycleFailure(model.Media{ID: "gone"}, "owner", "access_failed", "record_missing"); err != nil {
			t.Fatal(err)
		}
	}
	if len(lifecycleEvents(t, "gone")) != 1 {
		t.Fatal("duplicate errors")
	}
	current := time.Now().UTC().Truncate(time.Second)
	for _, e := range []model.OperationLog{
		{ID: "old-media", TargetType: MediaLifecycleTarget, CreatedAt: current.Add(-31 * 24 * time.Hour)},
		{ID: "kept-media", TargetType: MediaLifecycleTarget, CreatedAt: current.Add(-29 * 24 * time.Hour)},
		{ID: "boundary", TargetType: MediaLifecycleTarget, CreatedAt: current.Add(-30 * 24 * time.Hour)},
		{ID: "old-operation", CreatedAt: current.Add(-8 * 24 * time.Hour)},
		{ID: "kept-operation", CreatedAt: current.Add(-6 * 24 * time.Hour)},
	} {
		if err := SaveOperationLog(e); err != nil {
			t.Fatal(err)
		}
	}
	if err := DeleteExpiredOperationLogs(current); err != nil {
		t.Fatal(err)
	}
	db, _ := DB()
	var entries []model.OperationLog
	db.Find(&entries)
	if len(entries) != 4 {
		t.Fatalf("retention entries: %+v", entries)
	}
	for _, e := range entries {
		if e.ID == "old-media" || e.ID == "old-operation" {
			t.Fatal("expired audit retained")
		}
	}
}

func TestMediaLifecycleExpiryCancellationAndCanvasDeletion(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "media_audit_cancel"))
	if _, err := SaveMedia(model.Media{ID: "image", OwnerUID: "owner"}); err != nil {
		t.Fatal(err)
	}
	expiry := time.Now().Add(time.Minute)
	for _, e := range []*time.Time{&expiry, &expiry, nil, nil} {
		if _, err := SetPrivateMediaExpiry("image", "owner", e); err != nil {
			t.Fatal(err)
		}
	}
	if len(lifecycleEvents(t, "image")) != 3 {
		t.Fatal("expiry changes not recorded once")
	}
	doc := model.CanvasProjectDocument(`{"nodes":[{"type":"image","metadata":{"mediaId":"image"}}]}`)
	if _, _, err := CreateCanvasProject(model.CanvasProject{ID: "canvas", OwnerUID: "owner", Document: doc, Revision: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := DeleteCanvasProject("owner", "canvas", 1); err != nil {
		t.Fatal(err)
	}
	if events := lifecycleEvents(t, "image"); len(events) != 5 {
		t.Fatalf("missing canvas deletion event: %+v", events)
	}
}

func TestMediaLifecycleUploadCompletionIsRecordedOnce(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "media_audit_upload"))
	current := time.Now().UTC()
	intent := model.MediaUploadIntent{ID: "upload", OwnerUID: "owner", ExpiresAt: current.Add(time.Minute).Format(time.RFC3339Nano)}
	if err := SaveMediaUploadIntent(intent); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"first", "retry"} {
		if _, _, _, err := FinalizeMediaUploadIntent(intent.ID, intent.OwnerUID, current.Format(time.RFC3339Nano), model.Media{ID: id, OwnerUID: "owner", Source: model.MediaSourceUpload}); err != nil {
			t.Fatal(err)
		}
	}
	if len(lifecycleEvents(t, "first")) != 1 || len(lifecycleEvents(t, "retry")) != 0 {
		t.Fatal("upload replay duplicated creation audit")
	}
}
