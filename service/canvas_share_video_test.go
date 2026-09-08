package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

func TestVideoCanvasShareCopiesIndependentResourceAndClearsTaskIdentity(t *testing.T) {
	ctx := context.Background()
	sender := PortalUser{UID: "video-share-sender"}
	recipient := model.PortalMember{UserUID: "video-share-recipient", DisplayName: "接收者", Enabled: true}
	if err := repository.UpsertPortalMembers([]model.PortalMember{recipient}); err != nil {
		t.Fatal(err)
	}
	store, err := newImageStore()
	if err != nil {
		t.Fatal(err)
	}
	source := model.Media{ID: "video-share-source", OwnerUID: sender.UID, ObjectKey: "video-share/source.mp4", ContentType: "video/mp4", Bytes: 12, Duration: 6, Width: 1280, Height: 720, Filename: "source.mp4"}
	if err := store.Put(ctx, source.ObjectKey, []byte("source-video"), source.ContentType); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.SaveMedia(source); err != nil {
		t.Fatal(err)
	}
	raw := model.CanvasProjectDocument(`{"nodes":[{"id":"v1","type":"video","title":"视频","width":200,"height":100,"position":{"x":0,"y":0},"metadata":{"mediaId":"video-share-source","status":"success","videoTaskId":"sender-task","videoTaskClientRequestId":"sender-client","content":"blob:sender","storageKey":"video:sender"}},{"id":"v2","type":"video","title":"视频","width":200,"height":100,"position":{"x":220,"y":0},"metadata":{"mediaId":"video-share-source"}}],"connections":[],"backgroundMode":"lines","showImageInfo":false,"viewport":{"x":0,"y":0,"k":1}}`)
	project := model.CanvasProject{ID: "video-share-project", OwnerUID: sender.UID, Title: "视频", Revision: 1, Document: raw}
	if _, _, err := repository.CreateCanvasProject(project); err != nil {
		t.Fatal(err)
	}
	var sharedID string
	for i := 0; i < 2; i++ {
		result, err := ShareCanvasProject(ctx, sender, project.ID, CanvasShareInput{Revision: 1, RecipientUserUIDs: []string{recipient.UserUID}})
		if err != nil || len(result.Deliveries) != 1 || result.Deliveries[0].Status != "shared" {
			t.Fatalf("share: %+v %v", result, err)
		}
		if sharedID != "" && sharedID != result.Deliveries[0].ProjectID {
			t.Fatal("retry created duplicate project")
		}
		sharedID = result.Deliveries[0].ProjectID
	}
	shared, found, err := repository.GetCanvasProject(recipient.UserUID, sharedID)
	if err != nil || !found {
		t.Fatal(err)
	}
	var doc struct {
		Nodes []struct {
			Metadata map[string]any `json:"metadata"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(shared.Document, &doc); err != nil {
		t.Fatal(err)
	}
	id, _ := doc.Nodes[0].Metadata["mediaId"].(string)
	if id == "" || id == source.ID || doc.Nodes[1].Metadata["mediaId"] != id {
		t.Fatal("resource remapping failed")
	}
	if strings.Contains(string(shared.Document), "sender-task") || strings.Contains(string(shared.Document), "blob:sender") || strings.Contains(string(shared.Document), "video:sender") {
		t.Fatal("sender runtime identity leaked")
	}
	copied, found, err := repository.GetMedia(id)
	if err != nil || !found || copied.OwnerUID != recipient.UserUID || copied.Duration != 6 || copied.Width != 1280 || copied.Height != 720 || copied.ExpiresAt != nil {
		t.Fatalf("copied metadata: %+v %v", copied, err)
	}
	if err := store.Delete(ctx, source.ObjectKey); err != nil {
		t.Fatal(err)
	}
	reader, err := store.Get(ctx, copied.ObjectKey)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	data, err := io.ReadAll(reader)
	if err != nil || string(data) != "source-video" {
		t.Fatal("recipient depends on sender file")
	}
	if _, err := MediaAccessURL(ctx, PortalUser{UID: recipient.UserUID}, id); err != nil {
		t.Fatal(err)
	}
	if _, err := MediaAccessURL(ctx, sender, id); err == nil {
		t.Fatal("sender can access recipient private copy")
	}
}

func TestVideoShareRejectsUnfinishedAndLocalResources(t *testing.T) {
	for _, metadata := range []string{`{"storageKey":"video:old"}`, `{"status":"loading","mediaId":"persisted"}`, `{"videoTaskId":"running"}`} {
		if _, _, err := canvasShareDocument(model.CanvasProjectDocument(`{"nodes":[{"type":"video","metadata":` + metadata + `}]}`)); err == nil {
			t.Fatal("unfinished video accepted")
		}
	}
}

func TestVideoShareCopyFailureDoesNotCreateRecipientCanvas(t *testing.T) {
	store := localImageStore{directory: t.TempDir()}
	source := model.CanvasProject{ID: "missing-video", Title: "missing", Revision: 1}
	item := model.Media{ID: "missing-video", OwnerUID: "owner", ObjectKey: "missing.mp4", ContentType: "video/mp4", Bytes: 12}
	doc, _, err := canvasShareDocument(model.CanvasProjectDocument(`{"nodes":[{"type":"video","metadata":{"mediaId":"missing-video"}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := copyCanvasShareProject(context.Background(), store, source, doc, map[string]model.Media{item.ID: item}, model.PortalMember{UserUID: "missing-recipient"}, "missing-copy", PortalUser{UID: "owner"}); err == nil {
		t.Fatal("missing video copied")
	}
	if _, found, err := repository.GetCanvasProject("missing-recipient", "missing-copy"); err != nil || found {
		t.Fatal("failed copy published canvas")
	}
}

type shareTimeoutStore struct {
	localImageStore
	copiedKey          string
	deleteContextValid bool
}

func (store *shareTimeoutStore) Copy(ctx context.Context, source, target string) error {
	store.copiedKey = target
	// Simulate the server accepting the copy before the client times out.
	if err := store.localImageStore.Copy(context.Background(), source, target); err != nil {
		return err
	}
	<-ctx.Done()
	return ctx.Err()
}
func (store *shareTimeoutStore) Delete(ctx context.Context, key string) error {
	store.deleteContextValid = ctx.Err() == nil
	return store.localImageStore.Delete(ctx, key)
}

func TestVideoShareTimeoutKeepsExpiringCopyForCleanup(t *testing.T) {
	store := &shareTimeoutStore{localImageStore: localImageStore{directory: t.TempDir()}}
	source := model.Media{ID: "timeout-source", OwnerUID: "timeout-owner", ObjectKey: "source.mp4", ContentType: "video/mp4"}
	if err := store.Put(context.Background(), source.ObjectKey, []byte("video"), source.ContentType); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := copyCanvasShareMedia(ctx, store, source, "timeout-recipient"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout: %v", err)
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	var item model.Media
	if err := db.Where("object_key = ?", store.copiedKey).First(&item).Error; err != nil {
		t.Fatal(err)
	}
	if item.ExpiresAt == nil || !item.ExpiresAt.After(time.Now()) {
		t.Fatal("ambiguous copy lacks deferred cleanup")
	}
	cleanupCanvasShareMedia(ctx, store, []model.Media{item})
	if !store.deleteContextValid {
		t.Fatal("cleanup inherited expired request context")
	}
	if _, found, err := repository.GetMedia(item.ID); found || err != nil {
		t.Fatalf("cleanup: %v %v", found, err)
	}
}

func TestVideoShareCancelledRequestDoesNotCreateRecipientCopy(t *testing.T) {
	recipient := model.PortalMember{UserUID: "cancelled-share-recipient", Enabled: true}
	if err := repository.UpsertPortalMembers([]model.PortalMember{recipient}); err != nil {
		t.Fatal(err)
	}
	sender := PortalUser{UID: "cancelled-share-owner"}
	project := model.CanvasProject{ID: "cancelled-share", OwnerUID: sender.UID, Revision: 1, Title: "empty", Document: model.CanvasProjectDocument(`{"nodes":[],"connections":[],"backgroundMode":"lines","showImageInfo":false,"viewport":{"x":0,"y":0,"k":1}}`)}
	if _, _, err := repository.CreateCanvasProject(project); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err := ShareCanvasProject(ctx, sender, project.ID, CanvasShareInput{Revision: 1, RecipientUserUIDs: []string{recipient.UserUID}})
	if err != nil || len(result.Deliveries) != 1 || result.Deliveries[0].Status != "failed" || !strings.Contains(result.Deliveries[0].Message, "超时") {
		t.Fatalf("result: %+v %v", result, err)
	}
	if _, found, err := repository.GetCanvasProject(recipient.UserUID, canvasShareProjectID(project.ID, 1, recipient.UserUID)); found || err != nil {
		t.Fatalf("unexpected copy: %v %v", found, err)
	}
}
