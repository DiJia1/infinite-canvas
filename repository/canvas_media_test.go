package repository

import (
	"errors"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
)

func TestCanvasWritesRejectUnavailableMediaAtomically(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "canvas_media_atomic"))
	document := model.CanvasProjectDocument(`{"nodes":[{"type":"image","metadata":{"mediaId":"missing"}}]}`)
	if _, _, err := CreateCanvasProject(model.CanvasProject{ID: "create", OwnerUID: "owner", Document: document, Revision: 1}); !errors.Is(err, ErrCanvasMediaUnavailable) {
		t.Fatalf("create error = %v", err)
	}
	if _, found, err := GetCanvasProject("owner", "create"); err != nil || found {
		t.Fatalf("failed create persisted: %v %v", found, err)
	}
	if _, err := ImportCanvasProjects([]model.CanvasProject{{ID: "first", OwnerUID: "owner", Document: model.CanvasProjectDocument(`{}`), Revision: 1}, {ID: "second", OwnerUID: "owner", Document: document, Revision: 1}}); !errors.Is(err, ErrCanvasMediaUnavailable) {
		t.Fatalf("import error = %v", err)
	}
	if _, found, err := GetCanvasProject("owner", "first"); err != nil || found {
		t.Fatalf("failed import persisted: %v %v", found, err)
	}
}

func TestCanvasWritesCoordinateMediaExpiryAndReplay(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "canvas_media_expiry"))
	expiry := time.Now().UTC().Add(-time.Minute)
	if _, err := SaveMedia(model.Media{ID: "image", OwnerUID: "owner", ObjectKey: "image", ExpiresAt: &expiry}); err != nil {
		t.Fatal(err)
	}
	doc := model.CanvasProjectDocument(`{"nodes":[{"type":"image","metadata":{"mediaId":"image"}}]}`)
	if _, _, err := CreateCanvasProject(model.CanvasProject{ID: "project", OwnerUID: "owner", Document: doc, Revision: 1}); err != nil {
		t.Fatal(err)
	}
	media, _, _ := GetMedia("image")
	if media.ExpiresAt != nil {
		t.Fatal("create did not restore media")
	}
	if _, accepted, _, err := UpdateCanvasProjectIdempotently("owner", "project", 1, "", []byte(`{}`), "2026-09-07T01:00:00Z", "request", "hash"); err != nil || !accepted {
		t.Fatalf("remove: %v %v", accepted, err)
	}
	media, _, _ = GetMedia("image")
	if media.ExpiresAt == nil {
		t.Fatal("remove did not schedule cleanup")
	}
	deadline := *media.ExpiresAt
	if _, accepted, replayed, err := UpdateCanvasProjectIdempotently("owner", "project", 1, "", []byte(`{}`), "2026-09-07T02:00:00Z", "request", "hash"); err != nil || !accepted || !replayed {
		t.Fatalf("replay: %v %v %v", accepted, replayed, err)
	}
	media, _, _ = GetMedia("image")
	if media.ExpiresAt == nil || !media.ExpiresAt.Equal(deadline) {
		t.Fatal("replay changed expiry")
	}
	if _, accepted, err := UpdateCanvasProject("owner", "project", 2, "", doc, "2026-09-07T02:00:00Z"); err != nil || !accepted {
		t.Fatalf("restore: %v %v", accepted, err)
	}
	media, _, _ = GetMedia("image")
	if media.ExpiresAt != nil {
		t.Fatal("update did not restore media")
	}
}

func TestCanvasDocumentMediaIDsRejectsMalformedDocuments(t *testing.T) {
	for _, raw := range []string{`{`, `null`, `[]`, `{"nodes":123}`, `{"nodes":[{"type":"image","metadata":{"mediaId":3}}]}`} {
		if _, err := CanvasDocumentMediaIDs([]byte(raw)); !errors.Is(err, ErrCanvasMediaInvalidDocument) {
			t.Errorf("%s: %v", raw, err)
		}
	}
}

func TestCanvasUpdateRejectsDeletingRetainedMediaWithoutAdvancingRevision(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "canvas_media_deleting"))
	if _, err := SaveMedia(model.Media{ID: "image", OwnerUID: "owner", ObjectKey: "image"}); err != nil {
		t.Fatal(err)
	}
	doc := model.CanvasProjectDocument(`{"nodes":[{"type":"image","metadata":{"mediaId":"image"}}]}`)
	if _, _, err := CreateCanvasProject(model.CanvasProject{ID: "project", OwnerUID: "owner", Document: doc, Revision: 1}); err != nil {
		t.Fatal(err)
	}
	database, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Model(&model.Media{}).Where("id = ?", "image").Update("cleanup_status", "deleting").Error; err != nil {
		t.Fatal(err)
	}
	if _, accepted, err := UpdateCanvasProject("owner", "project", 1, "renamed", doc, ""); !errors.Is(err, ErrCanvasMediaUnavailable) || accepted {
		t.Fatalf("ordinary save: %v %v", accepted, err)
	}
	if _, accepted, _, err := UpdateCanvasProjectIdempotently("owner", "project", 1, "renamed", doc, "", "blocked-request", "hash"); !errors.Is(err, ErrCanvasMediaUnavailable) || accepted {
		t.Fatalf("idempotent save: %v %v", accepted, err)
	}
	project, _, err := GetCanvasProject("owner", "project")
	if err != nil || project.Revision != 1 {
		t.Fatalf("failed save advanced revision: %#v %v", project, err)
	}
	var count int64
	if err := database.Model(&model.CanvasSaveRequest{}).Where("request_id = ?", "blocked-request").Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("failed save kept receipt: %d %v", count, err)
	}
}

func TestCanvasImportIgnoresConflictingInputAndAllowsPublicMedia(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "canvas_media_import"))
	if _, _, err := CreateCanvasProject(model.CanvasProject{ID: "existing", OwnerUID: "owner", Document: model.CanvasProjectDocument(`{}`), Revision: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveMedia(model.Media{ID: "public", OwnerUID: "other", ObjectKey: "public"}); err != nil {
		t.Fatal(err)
	}
	if _, err := SavePublicImage(model.PublicImage{ID: "public-record", MediaID: "public"}); err != nil {
		t.Fatal(err)
	}
	imported, err := ImportCanvasProjects([]model.CanvasProject{
		{ID: "existing", OwnerUID: "owner", Document: model.CanvasProjectDocument(`{"nodes":[{"type":"image","metadata":{"mediaId":"missing"}}]}`), Revision: 2},
		{ID: "new", OwnerUID: "owner", Document: model.CanvasProjectDocument(`{"nodes":[{"type":"image","metadata":{"mediaId":"public"}}]}`), Revision: 1},
	})
	if err != nil || len(imported) != 2 || imported[0].Revision != 1 {
		t.Fatalf("import: %#v %v", imported, err)
	}
	privateDoc := model.CanvasProjectDocument(`{"nodes":[{"type":"image","metadata":{"mediaId":"public"}}]}`)
	database, _ := DB()
	if err := database.Delete(&model.PublicImage{}, "id = ?", "public-record").Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := CreateCanvasProject(model.CanvasProject{ID: "private", OwnerUID: "owner", Document: privateDoc, Revision: 1}); !errors.Is(err, ErrCanvasMediaUnavailable) {
		t.Fatalf("foreign private accepted: %v", err)
	}
}

func TestCanvasRemoveKeepsOtherProjectReferenceAndRejectsCorruptReferenceScan(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "canvas_media_shared"))
	if _, err := SaveMedia(model.Media{ID: "image", OwnerUID: "owner", ObjectKey: "image"}); err != nil {
		t.Fatal(err)
	}
	doc := model.CanvasProjectDocument(`{"nodes":[{"type":"image","metadata":{"mediaId":"image"}}]}`)
	for _, id := range []string{"a", "b"} {
		if _, _, err := CreateCanvasProject(model.CanvasProject{ID: id, OwnerUID: "owner", Document: doc, Revision: 1}); err != nil {
			t.Fatal(err)
		}
	}
	if _, ok, err := UpdateCanvasProject("owner", "a", 1, "", []byte(`{}`), ""); err != nil || !ok {
		t.Fatalf("remove: %v %v", ok, err)
	}
	item, _, _ := GetMedia("image")
	if item.ExpiresAt != nil {
		t.Fatal("other project reference was expired")
	}
	database, _ := DB()
	if err := database.Exec("UPDATE canvas_projects SET document = ? WHERE id = ? AND owner_uid = ?", `{"nodes":42}`, "a", "owner").Error; err != nil {
		t.Fatal(err)
	}
	if _, ok, err := UpdateCanvasProject("owner", "b", 1, "", []byte(`{}`), ""); !errors.Is(err, ErrCanvasMediaInvalidDocument) || ok {
		t.Fatalf("corrupt scan: %v %v", ok, err)
	}
	project, _, _ := GetCanvasProject("owner", "b")
	if project.Revision != 1 {
		t.Fatal("corrupt scan did not roll back save")
	}
}
