package repository

import (
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
)

func TestListPrivateMediaExcludesMediaPendingCleanup(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "private_media_cleanup"))
	now := time.Now().UTC()
	pendingAt := now.Add(5 * time.Minute)
	for _, item := range []model.Media{
		{ID: "active-media", OwnerUID: "owner", ObjectKey: "objects/active", Source: model.MediaSourceUpload},
		{ID: "pending-media", OwnerUID: "owner", ObjectKey: "objects/pending", Source: model.MediaSourceUpload, ExpiresAt: &pendingAt},
	} {
		if _, err := SaveMedia(item); err != nil {
			t.Fatalf("SaveMedia(%s): %v", item.ID, err)
		}
	}

	items, err := ListPrivateMedia("owner")
	if err != nil {
		t.Fatalf("ListPrivateMedia(): %v", err)
	}
	if len(items) != 1 || items[0].ID != "active-media" {
		t.Fatalf("ListPrivateMedia() = %#v, want only active-media", items)
	}
}
