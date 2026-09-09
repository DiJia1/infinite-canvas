package repository

import (
	"bytes"
	"errors"
	"log"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func useImageTaskTestDB(t *testing.T) {
	t.Helper()
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "image_generation_task"))
}

func TestListSucceededImageGenerationTasksFinishedBetweenReturnsOnlyCompletedTasks(t *testing.T) {
	useImageTaskTestDB(t)
	items := []model.ImageGenerationTask{
		{ID: "before", OwnerUID: "user", ClientRequestID: "before", Status: model.ImageTaskSucceeded, FinishedAt: "2026-09-02T15:59:59Z"},
		{ID: "included", OwnerUID: "included-user", Prompt: strings.Repeat("large", 1000), ProviderConfig: "sensitive-config", ReferencesJSON: `["large-reference"]`, ProviderID: "provider", ProviderName: "model", Resolution: "2K", ResultMediaIDsJSON: `["media"]`, ClientRequestID: "included", Status: model.ImageTaskSucceeded, FinishedAt: "2026-09-02T16:00:00Z", Amount: decimal.RequireFromString("0.1234"), AmountRecorded: true},
		{ID: "failed", OwnerUID: "user", ClientRequestID: "failed", Status: model.ImageTaskFailed, FinishedAt: "2026-09-02T20:00:00Z"},
		{ID: "after", OwnerUID: "user", ClientRequestID: "after", Status: model.ImageTaskSucceeded, FinishedAt: "2026-09-03T16:00:00Z"},
	}
	for _, item := range items {
		if _, _, err := CreateImageGenerationTask(item); err != nil {
			t.Fatal(err)
		}
	}

	result, err := ListSucceededImageGenerationTasksFinishedBetween("2026-09-02T16:00:00Z", "2026-09-03T16:00:00Z")
	if err != nil || len(result) != 1 || result[0].OwnerUID != "included-user" || !result[0].Amount.Equal(decimal.RequireFromString("0.1234")) || !result[0].AmountRecorded {
		t.Fatalf("ListSucceededImageGenerationTasksFinishedBetween() = %#v, %v", result, err)
	}
	if result[0].Prompt != "" || result[0].ProviderConfig != "" || result[0].ReferencesJSON != "" {
		t.Fatal("statistics loaded unrelated payload fields")
	}
	if result[0].ProviderID != "provider" || result[0].ProviderName != "model" || result[0].Resolution != "2K" || result[0].ResultMediaIDsJSON != `["media"]` {
		t.Fatalf("missing statistics fields: %#v", result[0])
	}

}

func TestCreateImageGenerationTaskIsIdempotentPerOwnerAndClientRequest(t *testing.T) {
	useImageTaskTestDB(t)
	item := model.ImageGenerationTask{ID: "task-1", OwnerUID: "user-1", ClientRequestID: "client-1", Status: model.ImageTaskQueued, CreatedAt: "2026-08-24T10:00:00Z", UpdatedAt: "2026-08-24T10:00:00Z"}

	created, inserted, err := CreateImageGenerationTask(item)
	if err != nil || !inserted || created.ID != "task-1" {
		t.Fatalf("first CreateImageGenerationTask() = %#v, %v, %v", created, inserted, err)
	}
	repeated, inserted, err := CreateImageGenerationTask(model.ImageGenerationTask{ID: "task-2", OwnerUID: "user-1", ClientRequestID: "client-1", Status: model.ImageTaskQueued})
	if err != nil || inserted || repeated.ID != "task-1" {
		t.Fatalf("repeated CreateImageGenerationTask() = %#v, %v, %v", repeated, inserted, err)
	}
	if _, inserted, err := CreateImageGenerationTask(model.ImageGenerationTask{ID: "task-3", OwnerUID: "user-2", ClientRequestID: "client-1", Status: model.ImageTaskQueued}); err != nil || !inserted {
		t.Fatalf("different owner task creation = inserted %v, err %v", inserted, err)
	}
}

func TestImageGenerationTaskLookupAndClaimAreOwnerScoped(t *testing.T) {
	useImageTaskTestDB(t)
	item := model.ImageGenerationTask{ID: "task-1", OwnerUID: "user-1", ClientRequestID: "client-1", Status: model.ImageTaskQueued, CreatedAt: "2026-08-24T10:00:00Z", UpdatedAt: "2026-08-24T10:00:00Z"}
	if _, _, err := CreateImageGenerationTask(item); err != nil {
		t.Fatalf("CreateImageGenerationTask() error = %v", err)
	}
	if _, found, err := GetImageGenerationTaskForOwner("task-1", "user-2"); err != nil || found {
		t.Fatalf("cross-owner lookup = found %v, err %v", found, err)
	}
	current := time.Now().UTC()
	claimed, found, err := ClaimNextImageGenerationTask(current, 45*time.Second)
	if err != nil || !found || claimed.ID != "task-1" || claimed.Status != model.ImageTaskQueued || claimed.ClaimID == "" || claimed.LeaseUntil == nil || !claimed.LeaseUntil.Equal(current.Add(45*time.Second)) {
		t.Fatalf("ClaimNextImageGenerationTask() = %#v, %v, %v", claimed, found, err)
	}
	if _, found, err := ClaimNextImageGenerationTask(current.Add(time.Second), 45*time.Second); err != nil || found {
		t.Fatalf("second claim = found %v, err %v", found, err)
	}
}

func TestClaimNextImageGenerationTaskDoesNotLogAnEmptyQueueAsAnError(t *testing.T) {
	useImageTaskTestDB(t)
	var logs bytes.Buffer
	database, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	db = database.Session(&gorm.Session{Logger: logger.New(log.New(&logs, "", 0), logger.Config{LogLevel: logger.Warn})})

	_, found, err := ClaimNextImageGenerationTask(time.Date(2026, 9, 2, 12, 0, 1, 0, time.UTC), 45*time.Second)
	if err != nil || found {
		t.Fatalf("empty claim = found %v, err %v", found, err)
	}
	if strings.Contains(logs.String(), "record not found") {
		t.Fatalf("idle claim logged an error: %s", logs.String())
	}
}

func TestClaimNextImageGenerationTaskOrdersEqualCreatedAtByID(t *testing.T) {
	useImageTaskTestDB(t)
	createdAt := "2026-09-02T12:00:00Z"
	for _, item := range []model.ImageGenerationTask{
		{ID: "task-z", OwnerUID: "user-1", ClientRequestID: "client-z", Status: model.ImageTaskQueued, CreatedAt: createdAt, UpdatedAt: createdAt},
		{ID: "task-a", OwnerUID: "user-1", ClientRequestID: "client-a", Status: model.ImageTaskQueued, CreatedAt: createdAt, UpdatedAt: createdAt},
	} {
		if _, _, err := CreateImageGenerationTask(item); err != nil {
			t.Fatalf("CreateImageGenerationTask(%q) error = %v", item.ID, err)
		}
	}

	claimed, found, err := ClaimNextImageGenerationTask(time.Now().UTC(), 45*time.Second)
	if err != nil || !found || claimed.ID != "task-a" {
		t.Fatalf("ClaimNextImageGenerationTask() = %#v, %v, %v", claimed, found, err)
	}
}

func TestImageGenerationTaskClaimFencesAnExpiredWorker(t *testing.T) {
	useImageTaskTestDB(t)
	current := time.Now().UTC()
	item := model.ImageGenerationTask{
		ID:              "task-stale",
		OwnerUID:        "user-1",
		ClientRequestID: "client-stale",
		Status:          model.ImageTaskSubmitting,
		CreatedAt:       "2026-09-02T11:00:00Z",
		UpdatedAt:       "2026-09-02T11:00:00Z",
	}
	if _, _, err := CreateImageGenerationTask(item); err != nil {
		t.Fatalf("CreateImageGenerationTask() error = %v", err)
	}
	first, found, err := ClaimNextImageGenerationTask(current, 45*time.Second)
	if err != nil || !found {
		t.Fatalf("first claim = %#v, %v, %v", first, found, err)
	}
	second, found, err := ClaimNextImageGenerationTask(current.Add(time.Minute), 45*time.Second)
	if err != nil || !found || second.ClaimID == first.ClaimID {
		t.Fatalf("replacement claim = %#v, %v, %v", second, found, err)
	}
	if err := UpdateClaimedImageGenerationTask(first, map[string]any{"status": model.ImageTaskFailed}); !errors.Is(err, ErrImageLeaseLost) {
		t.Fatalf("expired worker write = %v, want ErrImageLeaseLost", err)
	}
	if err := UpdateClaimedImageGenerationTask(second, map[string]any{"status": model.ImageTaskRunning}); err != nil {
		t.Fatalf("current worker write = %v", err)
	}
}

func TestImageGenerationTaskRejectsWritesAfterItsLeaseExpiresWithoutReplacement(t *testing.T) {
	useImageTaskTestDB(t)
	item := model.ImageGenerationTask{
		ID: "task-expired", OwnerUID: "user-1", ClientRequestID: "client-expired", Status: model.ImageTaskRunning,
		CreatedAt: "2026-09-02T11:00:00Z", UpdatedAt: "2026-09-02T11:00:00Z",
	}
	if _, _, err := CreateImageGenerationTask(item); err != nil {
		t.Fatalf("CreateImageGenerationTask() error = %v", err)
	}
	claimed, found, err := ClaimNextImageGenerationTask(time.Now().UTC().Add(-time.Minute), 10*time.Second)
	if err != nil || !found {
		t.Fatalf("expired claim fixture = %#v, %t, %v", claimed, found, err)
	}
	if err := UpdateClaimedImageGenerationTask(claimed, map[string]any{"status": model.ImageTaskSucceeded}); !errors.Is(err, ErrImageLeaseLost) {
		t.Fatalf("write after lease expiry = %v, want ErrImageLeaseLost", err)
	}
	if renewed, err := RenewImageGenerationTaskLease(claimed, time.Now().UTC(), 45*time.Second); err != nil || renewed {
		t.Fatalf("renew after lease expiry = %t, %v", renewed, err)
	}
}

func TestRenewImageGenerationTaskLeasePreventsASecondWorkerFromReclaimingAnActiveTask(t *testing.T) {
	useImageTaskTestDB(t)
	item := model.ImageGenerationTask{
		ID:              "task-active",
		OwnerUID:        "user-1",
		ClientRequestID: "client-active",
		Status:          model.ImageTaskSubmitting,
		CreatedAt:       "2026-08-27T10:00:00Z",
		UpdatedAt:       "2026-08-27T10:00:00Z",
	}
	if _, _, err := CreateImageGenerationTask(item); err != nil {
		t.Fatalf("CreateImageGenerationTask() error = %v", err)
	}

	current := time.Now().UTC()
	claimed, found, err := ClaimNextImageGenerationTask(current, 45*time.Second)
	if err != nil || !found {
		t.Fatalf("ClaimNextImageGenerationTask() = %#v, %v, %v", claimed, found, err)
	}
	renewedAt := current.Add(40 * time.Second)
	renewed, err := RenewImageGenerationTaskLease(claimed, renewedAt, 45*time.Second)
	if err != nil || !renewed {
		t.Fatalf("RenewImageGenerationTaskLease() = %v, %v", renewed, err)
	}

	if _, found, err := ClaimNextImageGenerationTask(renewedAt.Add(30*time.Second), 45*time.Second); err != nil || found {
		t.Fatalf("ClaimNextImageGenerationTask() reclaimed an active task: claimed=%v, err=%v", found, err)
	}
}

func TestCompleteImageGenerationTaskPublishesMediaWorkflowHoldAndAuditAtomically(t *testing.T) {
	useImageTaskTestDB(t)
	database, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	current := time.Now().UTC()
	leaseUntil := current.Add(time.Minute)
	task := model.ImageGenerationTask{
		ID: "image-complete", OwnerUID: "image-owner", ClientRequestID: "workflow-image-request",
		Status: model.ImageTaskRunning, ProviderTaskID: "upstream-image", OperationLogID: "image-complete-operation",
		ClaimID: "image-complete-claim", LeaseUntil: &leaseUntil, CreatedAt: current.Format(time.RFC3339), UpdatedAt: current.Format(time.RFC3339),
	}
	if err := database.Create(&model.OperationLog{ID: task.OperationLogID, ActorUID: task.OwnerUID, Status: model.OperationStatusSubmitted, CreatedAt: current}).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := CreateImageGenerationTask(task); err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&model.WorkflowRun{ID: "image-complete-run", OwnerUID: task.OwnerUID, RequestID: "image-complete-run-request", Status: "running"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&model.WorkflowOutputAttempt{
		ID: "image-complete-attempt", RunID: "image-complete-run", NodeID: "node", SlotID: "slot", Attempt: 1,
		OwnerUID: task.OwnerUID, RequestID: task.ClientRequestID, Status: "running",
	}).Error; err != nil {
		t.Fatal(err)
	}
	result := model.Media{ID: "image-complete-result", OwnerUID: task.OwnerUID, Source: model.MediaSourceGenerated, ObjectKey: "image/complete.png", ContentType: "image/png", CreatedAt: current.Format(time.RFC3339)}
	if err := CompleteImageGenerationTask(task, []model.Media{result}); err != nil {
		t.Fatal(err)
	}
	stored, found, err := GetImageGenerationTask(task.ID)
	if err != nil || !found || stored.Status != model.ImageTaskSucceeded || stored.ResultMediaIDsJSON != `["image-complete-result"]` || stored.ClaimID != "" || stored.LeaseUntil != nil {
		t.Fatalf("completed task = %#v, found=%t, err=%v", stored, found, err)
	}
	if media, found, err := GetMedia(result.ID); err != nil || !found || media.OwnerUID != task.OwnerUID {
		t.Fatalf("result media = %#v, found=%t, err=%v", media, found, err)
	}
	var refs []model.WorkflowMediaRef
	if err := database.Where("media_id = ?", result.ID).Find(&refs).Error; err != nil || len(refs) != 1 || refs[0].ScopeID != "image-complete-run" {
		t.Fatalf("workflow result refs = %+v, err=%v", refs, err)
	}
	var operation model.OperationLog
	if err := database.First(&operation, "id = ?", task.OperationLogID).Error; err != nil || operation.Status != model.OperationStatusSuccess || len(operation.MediaIDs) != 1 || operation.MediaIDs[0] != result.ID {
		t.Fatalf("operation = %#v, err=%v", operation, err)
	}
}

func TestCompleteImageGenerationTaskRejectsExpiredLeaseBeforePublishingMedia(t *testing.T) {
	useImageTaskTestDB(t)
	past := time.Now().UTC().Add(-time.Minute)
	task := model.ImageGenerationTask{
		ID: "image-expired-complete", OwnerUID: "image-owner", ClientRequestID: "image-expired-request",
		Status: model.ImageTaskRunning, ClaimID: "expired-claim", LeaseUntil: &past, CreatedAt: nowStringForRepositoryTest(), UpdatedAt: nowStringForRepositoryTest(),
	}
	if _, _, err := CreateImageGenerationTask(task); err != nil {
		t.Fatal(err)
	}
	result := model.Media{ID: "image-expired-result", OwnerUID: task.OwnerUID, ObjectKey: "image/expired.png", ContentType: "image/png"}
	if err := CompleteImageGenerationTask(task, []model.Media{result}); !errors.Is(err, ErrImageLeaseLost) {
		t.Fatalf("CompleteImageGenerationTask() error = %v, want ErrImageLeaseLost", err)
	}
	if _, found, err := GetMedia(result.ID); err != nil || found {
		t.Fatalf("expired worker published result: found=%t err=%v", found, err)
	}
	stored, found, err := GetImageGenerationTask(task.ID)
	if err != nil || !found || stored.Status != model.ImageTaskRunning || stored.ClaimID != task.ClaimID {
		t.Fatalf("expired task mutated = %#v, found=%t, err=%v", stored, found, err)
	}
}

func TestCompleteImageGenerationTaskRollsBackWhenAuditCannotBeCompleted(t *testing.T) {
	useImageTaskTestDB(t)
	future := time.Now().UTC().Add(time.Minute)
	task := model.ImageGenerationTask{
		ID: "image-audit-rollback", OwnerUID: "image-owner", ClientRequestID: "image-audit-request",
		Status: model.ImageTaskRunning, OperationLogID: "missing-image-operation", ClaimID: "image-audit-claim", LeaseUntil: &future,
		CreatedAt: nowStringForRepositoryTest(), UpdatedAt: nowStringForRepositoryTest(),
	}
	if _, _, err := CreateImageGenerationTask(task); err != nil {
		t.Fatal(err)
	}
	result := model.Media{ID: "image-audit-result", OwnerUID: task.OwnerUID, ObjectKey: "image/audit.png", ContentType: "image/png"}
	if err := CompleteImageGenerationTask(task, []model.Media{result}); err == nil {
		t.Fatal("completion without its audit record succeeded")
	}
	if _, found, err := GetMedia(result.ID); err != nil || found {
		t.Fatalf("failed atomic completion published media: found=%t err=%v", found, err)
	}
	stored, found, err := GetImageGenerationTask(task.ID)
	if err != nil || !found || stored.Status != model.ImageTaskRunning || stored.ClaimID != task.ClaimID {
		t.Fatalf("failed atomic completion mutated task = %#v, found=%t, err=%v", stored, found, err)
	}
}

func nowStringForRepositoryTest() string { return time.Now().UTC().Format(time.RFC3339) }
