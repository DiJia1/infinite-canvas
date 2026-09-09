package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"gorm.io/gorm"
)

func TestWorkflowSchedulerRecoversTheSameImageTaskWithoutResubmission(t *testing.T) {
	clearWorkflowRuntimeTables(t)
	previousConfig := config.Cfg
	config.Cfg.WorkflowEnabled = true
	config.Cfg.WorkflowGlobalConcurrency = 4
	config.Cfg.WorkflowRunConcurrency = 2
	t.Cleanup(func() { config.Cfg = previousConfig })
	seedWorkflowMember(t, "scheduler-owner", true)
	run := seedWorkflowImageRun(t, "scheduler-recovery", "scheduler-owner")

	previousCreate, previousGet := workflowCreateImageTask, workflowGetImageTask
	createCalls, getCalls := 0, 0
	workflowCreateImageTask = func(_ context.Context, request CreateImageTaskRequest) (ImageTaskView, error) {
		createCalls++
		if request.ClientRequestID == "" || request.Request.Prompt != "生成产品图" {
			t.Fatalf("unexpected workflow image request: %#v", request)
		}
		return ImageTaskView{ID: "durable-image-task", ClientRequestID: request.ClientRequestID, Status: "running"}, nil
	}
	workflowGetImageTask = func(_ context.Context, requestID string) (ImageTaskView, error) {
		getCalls++
		return ImageTaskView{ID: "durable-image-task", ClientRequestID: requestID, Status: "failed", Error: "供应商明确失败"}, nil
	}
	t.Cleanup(func() { workflowCreateImageTask, workflowGetImageTask = previousCreate, previousGet })

	processed, err := RunWorkflowSchedulerOnce(context.Background())
	if err != nil || !processed || createCalls != 1 || getCalls != 0 {
		t.Fatalf("first scheduler pass = %v, %v, create=%d get=%d", processed, err, createCalls, getCalls)
	}
	database, _ := repository.DB()
	if err := database.Model(&model.WorkflowOutputAttempt{}).Where("run_id = ?", run.ID).Update("next_poll_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	processed, err = RunWorkflowSchedulerOnce(context.Background())
	if err != nil || !processed || createCalls != 1 || getCalls != 1 {
		t.Fatalf("recovery scheduler pass = %v, %v, create=%d get=%d", processed, err, createCalls, getCalls)
	}
	record, found, err := repository.GetWorkflowRun(run.OwnerUID, run.ID)
	if err != nil || !found || len(record.Outputs) != 1 || record.Outputs[0].Status != "failed" || len(record.Attempts) != 1 || record.Attempts[0].TaskID != "durable-image-task" {
		t.Fatalf("recovered workflow record = %#v, %v, %v", record, found, err)
	}
}

func TestWorkflowSchedulerRejectsSubmissionAfterOwnerIsDisabled(t *testing.T) {
	clearWorkflowRuntimeTables(t)
	previousConfig := config.Cfg
	config.Cfg.WorkflowEnabled = true
	t.Cleanup(func() { config.Cfg = previousConfig })
	seedWorkflowMember(t, "disabled-workflow-owner", false)
	run := seedWorkflowImageRun(t, "disabled-run", "disabled-workflow-owner")
	previousCreate := workflowCreateImageTask
	createCalls := 0
	workflowCreateImageTask = func(context.Context, CreateImageTaskRequest) (ImageTaskView, error) {
		createCalls++
		return ImageTaskView{}, errors.New("must not submit")
	}
	t.Cleanup(func() { workflowCreateImageTask = previousCreate })

	if processed, err := RunWorkflowSchedulerOnce(context.Background()); err != nil || !processed {
		t.Fatalf("scheduler pass = %v, %v", processed, err)
	}
	record, found, err := repository.GetWorkflowRun(run.OwnerUID, run.ID)
	if err != nil || !found || createCalls != 0 || record.Outputs[0].Status != "failed" {
		t.Fatalf("disabled owner result = %#v, found=%v err=%v create=%d", record, found, err, createCalls)
	}
}

func TestWorkflowSchedulerRecoversAnExistingTaskAfterOwnerIsDisabled(t *testing.T) {
	clearWorkflowRuntimeTables(t)
	previousConfig := config.Cfg
	config.Cfg.WorkflowEnabled = true
	t.Cleanup(func() { config.Cfg = previousConfig })
	seedWorkflowMember(t, "disabled-recovery-owner", false)
	run := seedWorkflowImageRun(t, "disabled-recovery-run", "disabled-recovery-owner")
	if err := reevaluateWorkflowRun(run.OwnerUID, run.ID); err != nil {
		t.Fatal(err)
	}
	attempt, found, err := repository.ClaimWorkflowAttempt(4, 2, true, time.Now().UTC(), time.Minute)
	if err != nil || !found {
		t.Fatalf("claim = %#v, %v, %v", attempt, found, err)
	}
	authorized, err := repository.AuthorizeWorkflowAttemptSubmission(attempt, time.Now().UTC())
	if err != nil || !authorized {
		t.Fatalf("authorize = %v, %v", authorized, err)
	}
	attempt.Status = "submitting"
	imageTask := model.ImageGenerationTask{ID: "disabled-existing-task", OwnerUID: run.OwnerUID, ClientRequestID: attempt.RequestID, Status: model.ImageTaskRunning, CreatedAt: now(), UpdatedAt: now()}
	operation := model.OperationLog{ID: "disabled-existing-operation", ActorUID: run.OwnerUID, Status: model.OperationStatusSubmitted, CreatedAt: time.Now().UTC()}
	imageTask.OperationLogID = operation.ID
	if _, _, err := repository.CreateImageGenerationTaskWithOperationLog(imageTask, operation); err != nil {
		t.Fatal(err)
	}
	previousCreate, previousGet := workflowCreateImageTask, workflowGetImageTask
	createCalls, getCalls := 0, 0
	workflowCreateImageTask = func(context.Context, CreateImageTaskRequest) (ImageTaskView, error) {
		createCalls++
		return ImageTaskView{}, errors.New("must not create")
	}
	workflowGetImageTask = func(_ context.Context, requestID string) (ImageTaskView, error) {
		getCalls++
		return ImageTaskView{ID: imageTask.ID, ClientRequestID: requestID, Status: "failed", Error: "原任务失败"}, nil
	}
	t.Cleanup(func() { workflowCreateImageTask, workflowGetImageTask = previousCreate, previousGet })
	if err := processWorkflowAttempt(context.Background(), attempt); err != nil {
		t.Fatal(err)
	}
	record, _, _ := repository.GetWorkflowRun(run.OwnerUID, run.ID)
	if createCalls != 0 || getCalls != 1 || record.Attempts[0].TaskID != imageTask.ID || record.Outputs[0].Status != "failed" {
		t.Fatalf("disabled recovery = %#v create=%d get=%d", record, createCalls, getCalls)
	}
}

func TestWorkflowSchedulerKeepsPollingAfterATransientTaskLookupFailure(t *testing.T) {
	clearWorkflowRuntimeTables(t)
	previousConfig := config.Cfg
	config.Cfg.WorkflowEnabled = true
	t.Cleanup(func() { config.Cfg = previousConfig })
	seedWorkflowMember(t, "transient-owner", true)
	run := seedWorkflowImageRun(t, "transient-run", "transient-owner")
	previousCreate, previousGet := workflowCreateImageTask, workflowGetImageTask
	createCalls, getCalls := 0, 0
	workflowCreateImageTask = func(_ context.Context, request CreateImageTaskRequest) (ImageTaskView, error) {
		createCalls++
		return ImageTaskView{ID: "transient-task", ClientRequestID: request.ClientRequestID, Status: "running"}, nil
	}
	workflowGetImageTask = func(_ context.Context, requestID string) (ImageTaskView, error) {
		getCalls++
		return ImageTaskView{}, errors.New("temporary database failure")
	}
	t.Cleanup(func() { workflowCreateImageTask, workflowGetImageTask = previousCreate, previousGet })
	if processed, err := RunWorkflowSchedulerOnce(context.Background()); err != nil || !processed {
		t.Fatalf("initial pass = %v, %v", processed, err)
	}
	database, _ := repository.DB()
	if err := database.Model(&model.WorkflowOutputAttempt{}).Where("run_id = ?", run.ID).Update("next_poll_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if processed, err := RunWorkflowSchedulerOnce(context.Background()); err != nil || !processed {
		t.Fatalf("transient pass = %v, %v", processed, err)
	}
	record, _, _ := repository.GetWorkflowRun(run.OwnerUID, run.ID)
	if createCalls != 1 || getCalls != 1 || len(record.Attempts) != 1 || record.Attempts[0].Status != "running" || record.Outputs[0].Status != "running" {
		t.Fatalf("transient failure changed retryability: %#v create=%d get=%d", record, createCalls, getCalls)
	}
}

func TestWorkflowSchedulerRetriesATransientLocalTaskCreateWithTheSameRequest(t *testing.T) {
	clearWorkflowRuntimeTables(t)
	previousConfig := config.Cfg
	config.Cfg.WorkflowEnabled = true
	t.Cleanup(func() { config.Cfg = previousConfig })
	seedWorkflowMember(t, "create-transient-owner", true)
	run := seedWorkflowImageRun(t, "create-transient-run", "create-transient-owner")
	previousCreate := workflowCreateImageTask
	createCalls := 0
	requestIDs := []string{}
	workflowCreateImageTask = func(_ context.Context, request CreateImageTaskRequest) (ImageTaskView, error) {
		createCalls++
		requestIDs = append(requestIDs, request.ClientRequestID)
		return ImageTaskView{}, errors.New("temporary local database failure")
	}
	t.Cleanup(func() { workflowCreateImageTask = previousCreate })
	if processed, err := RunWorkflowSchedulerOnce(context.Background()); err != nil || !processed {
		t.Fatalf("first pass = %v, %v", processed, err)
	}
	database, _ := repository.DB()
	if err := database.Model(&model.WorkflowOutputAttempt{}).Where("run_id = ?", run.ID).Update("next_poll_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if processed, err := RunWorkflowSchedulerOnce(context.Background()); err != nil || !processed {
		t.Fatalf("second pass = %v, %v", processed, err)
	}
	record, _, _ := repository.GetWorkflowRun(run.OwnerUID, run.ID)
	if createCalls != 2 || len(requestIDs) != 2 || requestIDs[0] != requestIDs[1] || len(record.Attempts) != 1 || record.Attempts[0].Status != "submitting" {
		t.Fatalf("transient create recovery = %#v create=%d requestIDs=%v", record, createCalls, requestIDs)
	}
}

func TestWorkflowSchedulerPollsDueTasksWithoutStarvingReadyCapacity(t *testing.T) {
	clearWorkflowRuntimeTables(t)
	previousConfig := config.Cfg
	config.Cfg.WorkflowEnabled = true
	config.Cfg.WorkflowGlobalConcurrency = 4
	config.Cfg.WorkflowRunConcurrency = 2
	t.Cleanup(func() { config.Cfg = previousConfig })
	seedWorkflowMember(t, "fair-owner", true)
	for _, runID := range []string{"fair-running-one", "fair-running-two"} {
		run := seedWorkflowImageRun(t, runID, "fair-owner")
		if err := reevaluateWorkflowRun(run.OwnerUID, run.ID); err != nil {
			t.Fatal(err)
		}
		attempt, found, err := repository.ClaimWorkflowAttempt(4, 2, true, time.Now().UTC(), time.Minute)
		if err != nil || !found {
			t.Fatalf("seed claim = %#v, %v, %v", attempt, found, err)
		}
		if authorized, err := repository.AuthorizeWorkflowAttemptSubmission(attempt, time.Now().UTC()); err != nil || !authorized {
			t.Fatalf("seed authorize = %v, %v", authorized, err)
		}
		attempt.Status, attempt.TaskType, attempt.TaskID = "running", "image", "task-"+runID
		if err := repository.UpdateClaimedWorkflowAttempt(attempt, "running", time.Now().UTC().Add(time.Hour), false); err != nil {
			t.Fatal(err)
		}
	}
	database, _ := repository.DB()
	if err := database.Model(&model.WorkflowOutputAttempt{}).Where("run_id IN ?", []string{"fair-running-one", "fair-running-two"}).Update("next_poll_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	readyRun := seedWorkflowImageRun(t, "fair-ready", "fair-owner")
	previousCreate, previousGet := workflowCreateImageTask, workflowGetImageTask
	createCalls, getCalls := 0, 0
	workflowCreateImageTask = func(_ context.Context, request CreateImageTaskRequest) (ImageTaskView, error) {
		createCalls++
		return ImageTaskView{ID: "task-ready", ClientRequestID: request.ClientRequestID, Status: "running"}, nil
	}
	workflowGetImageTask = func(_ context.Context, requestID string) (ImageTaskView, error) {
		getCalls++
		return ImageTaskView{ID: "existing", ClientRequestID: requestID, Status: "running"}, nil
	}
	t.Cleanup(func() { workflowCreateImageTask, workflowGetImageTask = previousCreate, previousGet })
	if processed, err := RunWorkflowSchedulerOnce(context.Background()); err != nil || !processed {
		t.Fatalf("scheduler batch = %v, %v", processed, err)
	}
	record, found, err := repository.GetWorkflowRun(readyRun.OwnerUID, readyRun.ID)
	if err != nil || !found || createCalls != 1 || getCalls != 2 || len(record.Attempts) != 1 || record.Outputs[0].Status != "running" {
		t.Fatalf("fair scheduler result = %#v found=%v err=%v create=%d get=%d", record, found, err, createCalls, getCalls)
	}
}

func TestWorkflowStopBeforeSubmissionAuthorizationCreatesNoTask(t *testing.T) {
	clearWorkflowRuntimeTables(t)
	previousConfig := config.Cfg
	config.Cfg.WorkflowEnabled = true
	t.Cleanup(func() { config.Cfg = previousConfig })
	seedWorkflowMember(t, "stop-owner", true)
	run := seedWorkflowImageRun(t, "stop-run", "stop-owner")
	if err := reevaluateWorkflowRun(run.OwnerUID, run.ID); err != nil {
		t.Fatal(err)
	}
	attempt, found, err := repository.ClaimWorkflowAttempt(4, 2, true, time.Now().UTC(), time.Minute)
	if err != nil || !found {
		t.Fatalf("claim = %#v, %v, %v", attempt, found, err)
	}
	if changed, err := repository.RequestWorkflowRunStop(run.OwnerUID, run.ID, time.Now().UTC()); err != nil || !changed {
		t.Fatalf("stop = %v, %v", changed, err)
	}
	previousCreate := workflowCreateImageTask
	createCalls := 0
	workflowCreateImageTask = func(context.Context, CreateImageTaskRequest) (ImageTaskView, error) {
		createCalls++
		return ImageTaskView{}, nil
	}
	t.Cleanup(func() { workflowCreateImageTask = previousCreate })
	if err := processWorkflowAttempt(context.Background(), attempt); err != nil {
		t.Fatal(err)
	}
	record, _, _ := repository.GetWorkflowRun(run.OwnerUID, run.ID)
	if createCalls != 0 || record.Outputs[0].Status != "stopped" || record.Attempts[0].Status != "stopped" {
		t.Fatalf("stop boundary result = %#v create=%d", record, createCalls)
	}
}

func TestWorkflowEvaluationDoesNotWaitForAnUnconnectedSiblingSlot(t *testing.T) {
	graph := model.WorkflowGraph{Version: 1, Nodes: []model.WorkflowNode{
		{ID: "source", Type: model.WorkflowNodeImageGeneration, Outputs: []model.WorkflowOutputSlot{{ID: "used", Type: model.WorkflowPortImage}, {ID: "unrelated", Type: model.WorkflowPortImage}}},
		{ID: "prompt", Type: model.WorkflowNodeTextInput, Text: "继续处理"},
		{ID: "target", Type: model.WorkflowNodeImageGeneration},
	}, Connections: []model.WorkflowConnection{
		{SourceNodeID: "source", SourceSlotID: "used", TargetNodeID: "target", TargetPortID: "image", Order: 0},
		{SourceNodeID: "prompt", SourceSlotID: "output", TargetNodeID: "target", TargetPortID: "prompt", Order: 1},
	}}
	resolved, err := resolveWorkflowInputs(graph, "target", []model.WorkflowOutputExecution{
		{NodeID: "source", SlotID: "used", Status: "succeeded", MediaID: "used-media"},
		{NodeID: "source", SlotID: "unrelated", Status: "running"},
	})
	if err != nil || resolved.State != "ready" || len(resolved.ImageMediaIDs) != 1 || resolved.ImageMediaIDs[0] != "used-media" {
		t.Fatalf("resolved inputs = %#v, %v", resolved, err)
	}
}

func TestWorkflowRunAggregationKeepsUncertainWorkVisibleAndStopsAfterActiveWork(t *testing.T) {
	if status, finished := aggregateWorkflowRun(model.WorkflowRun{}, []model.WorkflowOutputExecution{{Status: "uncertain"}}); status != "attention_required" || finished != nil {
		t.Fatalf("uncertain aggregation = %q, %v", status, finished)
	}
	stopping := model.WorkflowRun{StopRequested: true}
	if status, finished := aggregateWorkflowRun(stopping, []model.WorkflowOutputExecution{{Status: "running"}, {Status: "stopped"}}); status != "stopping" || finished != nil {
		t.Fatalf("stopping aggregation = %q, %v", status, finished)
	}
	if status, finished := aggregateWorkflowRun(stopping, []model.WorkflowOutputExecution{{Status: "succeeded"}, {Status: "stopped"}}); status != "stopped" || finished == nil {
		t.Fatalf("stopped aggregation = %q, %v", status, finished)
	}
}

func seedWorkflowImageRun(t *testing.T, id, owner string) model.WorkflowRun {
	t.Helper()
	graph := model.WorkflowGraph{Version: 1, Nodes: []model.WorkflowNode{
		{ID: "prompt", Type: model.WorkflowNodeTextInput, Text: "生成产品图"},
		{ID: "generate", Type: model.WorkflowNodeImageGeneration, Config: &model.WorkflowNodeConfig{ProviderID: "frozen-provider", Resolution: "1k"}, Outputs: []model.WorkflowOutputSlot{{ID: "output", Type: model.WorkflowPortImage}}},
	}, Connections: []model.WorkflowConnection{{SourceNodeID: "prompt", SourceSlotID: "output", TargetNodeID: "generate", TargetPortID: "prompt", Order: 0}}}
	snapshot, _ := json.Marshal(graph)
	current := time.Now().UTC().Add(-time.Hour)
	run := model.WorkflowRun{ID: id, OwnerUID: owner, RequestID: id + "-request", Snapshot: string(snapshot), Status: "pending", CreatedAt: current, UpdatedAt: current}
	steps := []model.WorkflowStepExecution{{RunID: id, NodeID: "generate", Status: "waiting"}}
	outputs := []model.WorkflowOutputExecution{{RunID: id, NodeID: "generate", SlotID: "output", Status: "waiting", Attempt: 1, UpdatedAt: current}}
	if _, _, err := repository.CreateWorkflowRun(run, steps, outputs, nil); err != nil {
		t.Fatal(err)
	}
	return run
}

func seedWorkflowMember(t *testing.T, uid string, enabled bool) {
	t.Helper()
	database, _ := repository.DB()
	if err := database.Create(&model.PortalMember{UserUID: uid, DisplayName: uid, Enabled: enabled}).Error; err != nil {
		t.Fatal(err)
	}
}

func clearWorkflowRuntimeTables(t *testing.T) {
	t.Helper()
	database, _ := repository.DB()
	for _, item := range []any{&model.WorkflowOutputAttempt{}, &model.WorkflowOutputExecution{}, &model.WorkflowStepExecution{}, &model.WorkflowRun{}, &model.WorkflowMediaRef{}} {
		if err := database.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(item).Error; err != nil {
			t.Fatal(err)
		}
	}
}
