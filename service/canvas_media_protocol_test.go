package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"gorm.io/gorm"
)

func TestCanvasCreateRejectsMissingMediaWithoutPersistingDocument(t *testing.T) {
	const owner = "protocol-missing-owner"
	const projectID = "protocol-missing-project"
	_, err := CreateCanvasProject(context.Background(), PortalUser{UID: owner}, CanvasProjectInput{
		ID: projectID, Title: projectID, Document: testValidCanvasDocument("protocol-missing-media"),
	})
	if err == nil {
		t.Fatal("Canvas accepted a reference to a missing media record")
	}
	if _, found, err := repository.GetCanvasProject(owner, projectID); err != nil || found {
		t.Fatalf("rejected Canvas persisted: found=%t err=%v", found, err)
	}
}

func TestCanvasCleanupDatabaseFailureKeepsMediaDeleting(t *testing.T) {
	current := time.Now().UTC()
	expired := current.Add(-time.Minute)
	item := saveTestPrivateMedia(t, "protocol-db-failure-media", "protocol-db-failure-owner", &expired)
	store, err := newImageStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put(context.Background(), item.ObjectKey, []byte("image"), "image/png"); err != nil {
		t.Fatal(err)
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	const callback = "test:cleanup_delete_failure"
	if err := db.Callback().Delete().Before("gorm:delete").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "media" && strings.Contains(fmt.Sprint(tx.Statement.Clauses["WHERE"].Expression), item.ID) {
			tx.AddError(errors.New("injected media delete failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Delete().Remove(callback) })
	_ = CleanupExpiredCanvasMedia(current)
	stored, found, err := repository.GetMedia(item.ID)
	if err != nil || !found {
		t.Fatalf("media after failed DB delete: found=%t err=%v", found, err)
	}
	if stored.CleanupStatus != model.MediaCleanupDeleting {
		t.Fatalf("object is gone but media can be referenced: status=%q", stored.CleanupStatus)
	}
	if reader, err := store.Get(context.Background(), item.ObjectKey); !errors.Is(err, os.ErrNotExist) {
		if reader != nil {
			_ = reader.Close()
		}
		t.Fatalf("expected object to be deleted before DB failure, got %v", err)
	}
	assertCanvasProtocolRejectsReference(t, item, "db-failure")
	if err := db.Callback().Delete().Remove(callback); err != nil {
		t.Fatal(err)
	}
	if err := CleanupExpiredCanvasMedia(current.Add(canvasMediaCleanupLease + time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, found, err := repository.GetMedia(item.ID); err != nil || found {
		t.Fatalf("retry did not converge: found=%t err=%v", found, err)
	}
}

func TestCanvasCleanupMalformedDocumentDoesNotDeleteMedia(t *testing.T) {
	const owner = "protocol-malformed-owner"
	current := time.Now().UTC()
	expired := current.Add(-time.Minute)
	item := saveTestPrivateMedia(t, "protocol-malformed-media", owner, &expired)
	saveTestCanvasProject(t, "protocol-malformed-project", owner, testValidCanvasDocument())
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ? AND owner_uid = ?", "protocol-malformed-project", owner).Update("document", "{").Error; err != nil {
		t.Fatal(err)
	}
	store, err := newImageStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put(context.Background(), item.ObjectKey, []byte("image"), "image/png"); err != nil {
		t.Fatal(err)
	}
	_ = CleanupExpiredCanvasMedia(current)
	if _, found, err := repository.GetMedia(item.ID); err != nil || !found {
		t.Fatalf("malformed Canvas allowed media deletion: found=%t err=%v", found, err)
	}
	reader, err := store.Get(context.Background(), item.ObjectKey)
	if err != nil {
		t.Fatalf("malformed Canvas allowed object deletion: %v", err)
	}
	_ = reader.Close()
	stored, _, err := repository.GetMedia(item.ID)
	if err != nil || stored.CleanupStatus != model.MediaCleanupActive || stored.CleanupClaimID != "" {
		t.Fatalf("malformed document allowed a deletion claim: %#v %v", stored, err)
	}
}

type canvasCleanupTestStore struct {
	imageStore
	delete func(context.Context, string) error
}

func (store canvasCleanupTestStore) Delete(ctx context.Context, key string) error {
	return store.delete(ctx, key)
}

func assertCanvasProtocolRejectsReference(t *testing.T, item model.Media, suffix string) {
	t.Helper()
	ctx := context.Background()
	user := PortalUser{UID: item.OwnerUID}
	baseID := "protocol-rejected-" + suffix
	saveTestCanvasProject(t, baseID, user.UID, testValidCanvasDocument())
	document := testValidCanvasDocument(item.ID)
	operations := []struct {
		name string
		call func() error
	}{
		{"create", func() error {
			_, err := CreateCanvasProject(ctx, user, CanvasProjectInput{ID: baseID + "-create", Title: "create", Document: document})
			return err
		}},
		{"import", func() error {
			_, err := ImportCanvasProjects(ctx, user, []CanvasProjectInput{
				{ID: baseID + "-import-a", Title: "a", Document: testValidCanvasDocument()},
				{ID: baseID + "-import-b", Title: "b", Document: document},
			})
			return err
		}},
		{"update", func() error {
			_, _, err := UpdateCanvasProject(ctx, user, baseID, CanvasProjectUpdateInput{Revision: 1, Title: "changed", Document: document}, "")
			return err
		}},
		{"idempotent", func() error {
			_, _, err := UpdateCanvasProject(ctx, user, baseID, CanvasProjectUpdateInput{Revision: 1, Title: "changed", Document: document}, "9c7c03d3-a1bc-4f39-a8c7-02c4d549c68d")
			return err
		}},
	}
	for _, operation := range operations {
		if err := operation.call(); err == nil || !IsCanvasProjectValidationError(err) {
			t.Fatalf("%s accepted deleting media or returned unsafe error: %v", operation.name, err)
		}
	}
	project, found, err := repository.GetCanvasProject(user.UID, baseID)
	if err != nil || !found || project.Revision != 1 {
		t.Fatalf("rejected update changed Canvas: %#v found=%t err=%v", project, found, err)
	}
	for _, suffix := range []string{"-create", "-import-a", "-import-b"} {
		if _, found, err := repository.GetCanvasProject(user.UID, baseID+suffix); err != nil || found {
			t.Fatalf("rejected write persisted %s: found=%t err=%v", suffix, found, err)
		}
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	var receipts int64
	if err := db.Model(&model.CanvasSaveRequest{}).Where("project_id = ?", baseID).Count(&receipts).Error; err != nil || receipts != 0 {
		t.Fatalf("rejected save kept success receipt: %d %v", receipts, err)
	}
	stored, found, err := repository.GetMedia(item.ID)
	if err != nil || !found || stored.CleanupStatus != model.MediaCleanupDeleting {
		t.Fatalf("Canvas restored deleting media: %#v found=%t err=%v", stored, found, err)
	}
}

func TestCanvasCleanupClaimCommittedBeforeObjectDelete(t *testing.T) {
	current := time.Now().UTC()
	expired := current.Add(-time.Minute)
	item := saveTestPrivateMedia(t, "protocol-barrier-media", "protocol-barrier-owner", &expired)
	base, err := newImageStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := base.Put(context.Background(), item.ObjectKey, []byte("image"), "image/png"); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	store := canvasCleanupTestStore{imageStore: base, delete: func(ctx context.Context, key string) error {
		if key == item.ObjectKey {
			close(entered)
			<-release
		}
		return base.Delete(ctx, key)
	}}
	done := make(chan struct{})
	var cleanupErr error
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	go func() {
		cleanupErr = cleanupExpiredCanvasMedia(context.Background(), current, func() (imageStore, error) { return store, nil })
		close(done)
	}()
	defer func() {
		unblock()
		select {
		case <-done:
			if cleanupErr != nil {
				t.Errorf("cleanup: %v", cleanupErr)
			}
		case <-time.After(10 * time.Second):
			t.Error("cleanup did not finish after barrier release")
		}
	}()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("cleanup never reached object-delete barrier")
	}
	assertCanvasProtocolRejectsReference(t, item, "barrier")
	// The save has returned while object deletion is still blocked: no database
	// transaction is held across the external request.
	unblock()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("cleanup did not finish")
	}
	if _, found, err := repository.GetMedia(item.ID); err != nil || found {
		t.Fatalf("completed cleanup left media: found=%t err=%v", found, err)
	}
}

func TestCanvasCleanupObjectFailuresRetryWithoutRestoringMedia(t *testing.T) {
	for _, failure := range []string{"denied", "timeout-after-delete", "oss-404", "local-missing"} {
		t.Run(failure, func(t *testing.T) {
			current := time.Now().UTC()
			expired := current.Add(-time.Minute)
			item := saveTestPrivateMedia(t, "protocol-"+failure+"-media", "protocol-"+failure+"-owner", &expired)
			base, err := newImageStore()
			if err != nil {
				t.Fatal(err)
			}
			if err := base.Put(context.Background(), item.ObjectKey, []byte("image"), "image/png"); err != nil {
				t.Fatal(err)
			}
			attempts := 0
			store := canvasCleanupTestStore{imageStore: base, delete: func(ctx context.Context, key string) error {
				if key != item.ObjectKey {
					return base.Delete(ctx, key)
				}
				attempts++
				if attempts == 1 {
					switch failure {
					case "denied":
						return &oss.ServiceError{StatusCode: http.StatusForbidden, Code: "AccessDenied"}
					case "timeout-after-delete":
						if err := base.Delete(ctx, key); err != nil {
							return err
						}
						return context.DeadlineExceeded
					case "oss-404":
						if err := base.Delete(ctx, key); err != nil {
							return err
						}
						return &oss.ServiceError{StatusCode: http.StatusNotFound, Code: "NoSuchKey"}
					case "local-missing":
						if err := base.Delete(ctx, key); err != nil {
							return err
						}
						return os.ErrNotExist
					}
				}
				return base.Delete(ctx, key)
			}}
			run := func(at time.Time) {
				t.Helper()
				if err := cleanupExpiredCanvasMedia(context.Background(), at, func() (imageStore, error) { return store, nil }); err != nil {
					t.Fatal(err)
				}
			}
			run(current)
			if failure == "denied" || failure == "timeout-after-delete" {
				assertCanvasProtocolRejectsReference(t, item, failure)
				run(current.Add(time.Second))
				if attempts != 1 {
					t.Fatalf("second worker reused live claim: attempts=%d", attempts)
				}
				run(current.Add(canvasMediaCleanupLease + time.Second))
				if attempts != 2 {
					t.Fatalf("expired claim was not retried: attempts=%d", attempts)
				}
			}
			if _, found, err := repository.GetMedia(item.ID); err != nil || found {
				t.Fatalf("cleanup did not converge: found=%t err=%v", found, err)
			}
		})
	}
}

func TestCanvasCleanupResumesAbandonedClaim(t *testing.T) {
	current := time.Now().UTC()
	expired := current.Add(-time.Minute)
	item := saveTestPrivateMedia(t, "protocol-abandoned-media", "protocol-abandoned-owner", &expired)
	store, err := newImageStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put(context.Background(), item.ObjectKey, []byte("image"), "image/png"); err != nil {
		t.Fatal(err)
	}
	claimed, ok, err := repository.ClaimCanvasMediaCleanup(item.ID, current, canvasMediaCleanupLease)
	if err != nil || !ok || claimed.CleanupClaimID == "" {
		t.Fatalf("claim: %#v %t %v", claimed, ok, err)
	}
	// No deletion follows this committed claim, as if its process exited.
	assertCanvasProtocolRejectsReference(t, item, "abandoned")
	if err := CleanupExpiredCanvasMedia(current.Add(canvasMediaCleanupLease + time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, found, err := repository.GetMedia(item.ID); err != nil || found {
		t.Fatalf("abandoned claim not resumed: found=%t err=%v", found, err)
	}
}

func TestDeletingCanvasMediaCannotBeAccessedOrShared(t *testing.T) {
	current := time.Now().UTC()
	expired := current.Add(-time.Minute)
	item := saveTestPrivateMedia(t, "protocol-access-media", "protocol-access-owner", &expired)
	item, claimed, err := repository.ClaimCanvasMediaCleanup(item.ID, current, canvasMediaCleanupLease)
	if err != nil || !claimed {
		t.Fatalf("claim: %t %v", claimed, err)
	}
	user := PortalUser{UID: item.OwnerUID}
	if allowed, err := canAccessMedia(context.Background(), user, item); err != nil || allowed {
		t.Errorf("owner can access deleting media: allowed=%t err=%v", allowed, err)
	}
	if canAccessPublicMedia(user, item) {
		t.Error("deleting media is publicly accessible")
	}
	if _, err := MediaAccessURL(context.Background(), user, item.ID); err == nil {
		t.Error("deleting media receives a signed URL")
	}
	if _, err := canvasShareSourceMedia(user, []string{item.ID}); err == nil {
		t.Error("deleting media accepted as a share source")
	}
}

func TestCanvasCleanupSlowFailuresDoNotStarveLaterClaims(t *testing.T) {
	now := time.Now().UTC()
	expiry := now.Add(-time.Minute)
	var ids []string
	for i := 0; i < 6; i++ {
		item := saveTestPrivateMedia(t, fmt.Sprintf("slow-claim-%d", i), "slow-claim-owner", &expiry)
		ids = append(ids, item.ID)
	}
	claimed, err := repository.ClaimCanvasMediaCleanupBatch(ids, now, canvasMediaCleanupLease)
	if err != nil || len(claimed) != 6 {
		t.Fatalf("claims=%d err=%v", len(claimed), err)
	}
	attempts := 0
	store := canvasCleanupTestStore{delete: func(context.Context, string) error {
		attempts++
		now = now.Add(30 * time.Second)
		if attempts <= 5 {
			return context.DeadlineExceeded
		}
		return nil
	}}
	if err := deleteClaimedCanvasMedia(context.Background(), store, claimed, func() time.Time { return now }); err != nil {
		t.Fatal(err)
	}
	if attempts != 6 {
		t.Fatalf("attempts=%d", attempts)
	}
	if _, found, err := repository.GetMedia(ids[5]); err != nil || found {
		t.Fatalf("healthy trailing media remains: %v %v", found, err)
	}
}
