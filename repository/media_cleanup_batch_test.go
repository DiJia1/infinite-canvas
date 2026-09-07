package repository

import (
	"errors"
	"fmt"
	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
	"testing"
	"time"
)

func TestCanvasCleanupBatchScansEachOwnerOnce(t *testing.T) {
	db, current := seedCleanupProtocolMedia(t, "cleanup_batch")
	expiry := current.Add(-time.Minute)
	for _, id := range []string{"kept", "public", "free", "other"} {
		owner := "owner"
		if id == "other" {
			owner = "other-owner"
		}
		if _, err := SaveMedia(model.Media{ID: id, OwnerUID: owner, ObjectKey: id, ExpiresAt: &expiry}); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []model.CanvasProject{
		{ID: "p1", OwnerUID: "owner", Document: []byte(`{"nodes":[{"type":"image","metadata":{"mediaId":"image"}},{"type":"image","metadata":{"mediaId":"kept"}}]}`)},
		{ID: "p2", OwnerUID: "owner", Document: []byte(`{"nodes":[{"type":"image","metadata":{"mediaId":"image"}}]}`)},
		{ID: "p3", OwnerUID: "other-owner", Document: []byte(`{"nodes":[{"type":"image","metadata":{"mediaId":"free"}}]}`)},
	} {
		if err := db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.PublicImage{ID: "public-image", MediaID: "public"}).Error; err != nil {
		t.Fatal(err)
	}
	scans, publicQueries := 0, 0
	if err := db.Callback().Row().Before("gorm:row").Register("count_canvas_scans", func(tx *gorm.DB) {
		if tx.Statement.Table == "canvas_projects" {
			scans++
		}
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Query().Before("gorm:query").Register("count_public_queries", func(tx *gorm.DB) {
		if tx.Statement.Table == "public_images" {
			publicQueries++
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Callback().Row().Remove("count_canvas_scans")
		db.Callback().Query().Remove("count_public_queries")
	})
	items, err := ClaimCanvasMediaCleanupBatch([]string{"image", "kept", "public", "free", "other"}, current, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].ID != "free" || items[1].ID != "other" {
		t.Fatalf("claims = %#v", items)
	}
	if scans != 2 || publicQueries != 1 {
		t.Fatalf("canvas scans=%d public queries=%d", scans, publicQueries)
	}
}
func TestCanvasCleanupBatchMalformedDocumentRollsBackAllClaims(t *testing.T) {
	db, current := seedCleanupProtocolMedia(t, "cleanup_batch_invalid")
	if err := db.Create(&model.CanvasProject{ID: "bad", OwnerUID: "owner", Document: []byte(`{"nodes":123}`)}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := ClaimCanvasMediaCleanupBatch([]string{"image"}, current, time.Minute); !errors.Is(err, ErrCanvasMediaInvalidDocument) {
		t.Fatalf("error=%v", err)
	}
	item, _, _ := GetMedia("image")
	if item.CleanupStatus != model.MediaCleanupActive {
		t.Fatal("invalid document claimed media")
	}
}
func TestExpiredPrivateMediaCandidatesAreBounded(t *testing.T) {
	db, current := seedCleanupProtocolMedia(t, "cleanup_batch_limit")
	expiry := current.Add(-time.Minute)
	for i := 0; i < 105; i++ {
		if err := db.Create(&model.Media{ID: fmt.Sprintf("candidate-%03d", i), OwnerUID: "owner", ObjectKey: fmt.Sprintf("object-%03d", i), ExpiresAt: &expiry}).Error; err != nil {
			t.Fatal(err)
		}
	}
	items, err := ListExpiredPrivateMedia(current)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) > 100 || len(items) == 0 {
		t.Fatalf("candidate count=%d", len(items))
	}
}

func TestCanvasCleanupBatchInvalidOwnerDoesNotBlockOtherOwners(t *testing.T) {
	db, current := seedCleanupProtocolMedia(t, "cleanup_invalid_owner")
	expiry := current.Add(-time.Minute)
	if err := db.Create(&model.CanvasProject{ID: "bad", OwnerUID: "owner", Document: []byte(`{"nodes":123}`)}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := SaveMedia(model.Media{ID: "safe", OwnerUID: "another-owner", ObjectKey: "safe", ExpiresAt: &expiry}); err != nil {
		t.Fatal(err)
	}
	items, err := ClaimCanvasMediaCleanupBatch([]string{"image", "safe"}, current, time.Minute)
	if !errors.Is(err, ErrCanvasMediaInvalidDocument) || len(items) != 1 || items[0].ID != "safe" {
		t.Fatalf("claims=%#v error=%v", items, err)
	}
	item, _, _ := GetMedia("image")
	if item.CleanupStatus != model.MediaCleanupActive {
		t.Fatal("corrupt owner media claimed")
	}
}

func TestCanvasCleanupPaginationAdvancesPastInvalidOwner(t *testing.T) {
	db, current := seedCleanupProtocolMedia(t, "cleanup_invalid_page")
	if err := db.Create(&model.CanvasProject{ID: "bad", OwnerUID: "owner", Document: []byte(`{"nodes":123}`)}).Error; err != nil {
		t.Fatal(err)
	}
	expiry := current.Add(-time.Minute)
	for i := 0; i < 100; i++ {
		id := fmt.Sprintf("bad-%03d", i)
		if _, err := SaveMedia(model.Media{ID: id, OwnerUID: "owner", ObjectKey: id, ExpiresAt: &expiry}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := SaveMedia(model.Media{ID: "z-good", OwnerUID: "good-owner", ObjectKey: "good", ExpiresAt: &expiry}); err != nil {
		t.Fatal(err)
	}
	cursor := ""
	scanned := 0
	var claimed []model.Media
	for {
		page, err := ListExpiredPrivateMediaAfter(current, cursor)
		if err != nil {
			t.Fatal(err)
		}
		if len(page) == 0 {
			break
		}
		if len(page) > 100 {
			t.Fatal("unbounded page")
		}
		scanned += len(page)
		cursor = page[len(page)-1].ID
		ids := make([]string, 0, len(page))
		for _, item := range page {
			ids = append(ids, item.ID)
		}
		items, err := ClaimCanvasMediaCleanupBatch(ids, current, time.Minute)
		if err != nil && !errors.Is(err, ErrCanvasMediaInvalidDocument) {
			t.Fatal(err)
		}
		claimed = append(claimed, items...)
	}
	if scanned != 102 || len(claimed) != 1 || claimed[0].ID != "z-good" {
		t.Fatalf("scanned=%d claims=%#v", scanned, claimed)
	}
}

func TestCanvasCleanupRenewalIsFencedByTakeover(t *testing.T) {
	_, current := seedCleanupProtocolMedia(t, "cleanup_renew")
	first, _, err := ClaimCanvasMediaCleanup("image", current, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	next, claimed, err := ClaimCanvasMediaCleanup("image", current.Add(time.Minute), time.Minute)
	if err != nil || !claimed {
		t.Fatal(err)
	}
	if renewed, err := RenewCanvasMediaCleanupClaim("image", first.CleanupClaimID, current.Add(2*time.Minute), time.Minute); err != nil || renewed {
		t.Fatalf("stale renewal=%v err=%v", renewed, err)
	}
	if renewed, err := RenewCanvasMediaCleanupClaim("image", next.CleanupClaimID, current.Add(2*time.Minute), time.Minute); err != nil || !renewed {
		t.Fatalf("current renewal=%v err=%v", renewed, err)
	}
}
