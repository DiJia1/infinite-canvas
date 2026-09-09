package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/ai"
	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

const (
	workflowAttemptLease = 30 * time.Second
	workflowPollDelay    = time.Second
)

var (
	workflowCreateImageTask = CreateImageTask
	workflowGetImageTask    = GetImageTaskByClientRequest
)

func workflowsEnabled() bool {
	return config.Cfg.WorkflowEnabled
}

func workflowConcurrency() (int, int) {
	global, perRun := config.Cfg.WorkflowGlobalConcurrency, config.Cfg.WorkflowRunConcurrency
	if global <= 0 {
		global = 4
	}
	if perRun <= 0 {
		perRun = 2
	}
	if perRun > global {
		perRun = global
	}
	return global, perRun
}

func StartWorkflowScheduler(ctx context.Context) (func(), error) {
	if _, err := repository.DB(); err != nil {
		return nil, err
	}
	workerContext, cancel := context.WithCancel(ctx)
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			if _, err := RunWorkflowSchedulerOnce(workerContext); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("workflow scheduler failed: %v", err)
			}
			select {
			case <-workerContext.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return cancel, nil
}

// RunWorkflowSchedulerOnce is intentionally bounded so every pass releases DB
// leases quickly and another service instance can take over after a crash.
func RunWorkflowSchedulerOnce(ctx context.Context) (bool, error) {
	if err := reevaluateOpenWorkflowRuns(); err != nil {
		return false, err
	}
	global, perRun := workflowConcurrency()
	processed := false
	// A bounded batch services existing polls and then uses any remaining
	// capacity for ready outputs. Since every processed attempt is scheduled in
	// the future, one batch cannot immediately reclaim the same row.
	for count := 0; count < global*2; count++ {
		attempt, found, err := repository.ClaimWorkflowAttempt(global, perRun, workflowsEnabled(), time.Now().UTC(), workflowAttemptLease)
		if err != nil {
			return processed, err
		}
		if !found {
			break
		}
		processed = true
		if err := processWorkflowAttempt(ctx, attempt); err != nil && !errors.Is(err, repository.ErrWorkflowLeaseLost) {
			return true, err
		}
		if err := reevaluateWorkflowRun(attempt.OwnerUID, attempt.RunID); err != nil {
			return true, err
		}
	}
	return processed, nil
}

func reevaluateOpenWorkflowRuns() error {
	runs, err := repository.ListOpenWorkflowRuns(200)
	if err != nil {
		return err
	}
	for _, run := range runs {
		if err := reevaluateWorkflowRun(run.OwnerUID, run.ID); err != nil {
			return err
		}
	}
	return nil
}

func reevaluateWorkflowRun(ownerUID, runID string) error {
	record, found, err := repository.GetWorkflowRun(ownerUID, runID)
	if err != nil || !found {
		return err
	}
	var graph model.WorkflowGraph
	if err := json.Unmarshal([]byte(record.Run.Snapshot), &graph); err != nil {
		return err
	}
	nodes := map[string]model.WorkflowNode{}
	for _, node := range graph.Nodes {
		nodes[node.ID] = node
	}
	updates := []model.WorkflowOutputExecution{}
	for index := range record.Outputs {
		output := &record.Outputs[index]
		if output.Status != "waiting" && output.Status != "ready" && output.Status != "blocked" {
			continue
		}
		next := output.Status
		if record.Run.StopRequested {
			next = "stopped"
		} else {
			node := nodes[output.NodeID]
			resolved, resolveErr := resolveWorkflowInputs(graph, output.NodeID, record.Outputs)
			switch {
			case resolveErr != nil:
				next, output.Error = "failed", resolveErr.Error()
			case resolved.State == "blocked":
				next, output.Error = "blocked", "上游输出失败"
			case resolved.State == "waiting":
				next, output.Error = "waiting", ""
			case node.Type == model.WorkflowNodeVideoGeneration:
				// T5 enables video submission; preserving waiting here prevents any
				// accidental paid request in the image execution milestone.
				next, output.Error = "waiting", ""
			default:
				next, output.Error = "ready", ""
			}
		}
		if next != output.Status || output.Error != "" {
			output.Status = next
			updates = append(updates, *output)
		}
	}
	steps := changedWorkflowSteps(record.Steps, aggregateWorkflowSteps(record.Run.ID, record.Outputs))
	status, finishedAt := aggregateWorkflowRun(record.Run, record.Outputs)
	if len(updates) == 0 && len(steps) == 0 && status == record.Run.Status {
		return nil
	}
	err = repository.UpdateWorkflowEvaluation(record.Run.ID, record.Run.StateVersion, updates, steps, status, finishedAt, time.Now().UTC())
	if errors.Is(err, repository.ErrWorkflowRunStale) {
		return nil
	}
	return err
}

func changedWorkflowSteps(current, next []model.WorkflowStepExecution) []model.WorkflowStepExecution {
	byNode := map[string]model.WorkflowStepExecution{}
	for _, step := range current {
		byNode[step.NodeID] = step
	}
	changed := []model.WorkflowStepExecution{}
	for _, step := range next {
		before, found := byNode[step.NodeID]
		if !found || before.Status != step.Status || before.Error != step.Error {
			changed = append(changed, step)
		}
	}
	return changed
}

func aggregateWorkflowSteps(runID string, outputs []model.WorkflowOutputExecution) []model.WorkflowStepExecution {
	grouped := map[string][]model.WorkflowOutputExecution{}
	for _, output := range outputs {
		grouped[output.NodeID] = append(grouped[output.NodeID], output)
	}
	steps := make([]model.WorkflowStepExecution, 0, len(grouped))
	for nodeID, slots := range grouped {
		status, firstError := "succeeded", ""
		for _, slot := range slots {
			if firstError == "" && slot.Error != "" {
				firstError = slot.Error
			}
			switch slot.Status {
			case "uncertain":
				status = "uncertain"
			case "submitting", "running":
				if status != "uncertain" {
					status = "running"
				}
			case "waiting", "ready":
				if status != "uncertain" && status != "running" {
					status = "waiting"
				}
			case "failed", "blocked":
				if status == "succeeded" {
					status = slot.Status
				}
			case "stopped":
				if status == "succeeded" {
					status = "stopped"
				}
			}
		}
		steps = append(steps, model.WorkflowStepExecution{RunID: runID, NodeID: nodeID, Status: status, Error: firstError})
	}
	return steps
}

func aggregateWorkflowRun(run model.WorkflowRun, outputs []model.WorkflowOutputExecution) (string, *time.Time) {
	if len(outputs) == 0 {
		current := time.Now().UTC()
		return "completed", &current
	}
	success, active, pending, uncertain := 0, 0, 0, 0
	for _, output := range outputs {
		switch output.Status {
		case "succeeded":
			success++
		case "submitting", "running":
			active++
		case "waiting", "ready":
			pending++
		case "uncertain":
			uncertain++
		}
	}
	if uncertain > 0 {
		return "attention_required", nil
	}
	if active > 0 || pending > 0 {
		if run.StopRequested {
			return "stopping", nil
		}
		return "running", nil
	}
	current := time.Now().UTC()
	if run.StopRequested {
		return "stopped", &current
	}
	if success == len(outputs) {
		return "completed", &current
	}
	if success > 0 {
		return "partially_completed", &current
	}
	return "failed", &current
}

func processWorkflowAttempt(ctx context.Context, attempt model.WorkflowOutputAttempt) error {
	record, found, err := repository.GetWorkflowRun(attempt.OwnerUID, attempt.RunID)
	if err != nil || !found {
		return err
	}
	var graph model.WorkflowGraph
	if err := json.Unmarshal([]byte(record.Run.Snapshot), &graph); err != nil {
		return failWorkflowAttempt(attempt, err)
	}
	if attempt.TaskID == "" && attempt.Status == "claimed" && !workflowsEnabled() {
		attempt.Status = "claimed"
		return repository.UpdateClaimedWorkflowAttempt(attempt, "submitting", time.Now().UTC().Add(5*time.Second), false)
	}
	if attempt.TaskID == "" && attempt.Status == "claimed" {
		authorized, err := repository.AuthorizeWorkflowAttemptSubmission(attempt, time.Now().UTC())
		if err != nil || !authorized {
			return err
		}
		attempt.Status = "submitting"
	}
	var node model.WorkflowNode
	for _, candidate := range graph.Nodes {
		if candidate.ID == attempt.NodeID {
			node = candidate
			break
		}
	}
	if node.ID == "" || node.Type != model.WorkflowNodeImageGeneration {
		return failWorkflowAttempt(attempt, fmt.Errorf("workflow node is not an image generation step"))
	}
	userContext := WithPortalUser(ctx, PortalUser{UID: attempt.OwnerUID})
	var view ImageTaskView
	if attempt.TaskID == "" {
		if existing, found, lookupErr := repository.GetImageGenerationTaskByClientRequest(attempt.OwnerUID, attempt.RequestID); lookupErr != nil {
			return deferWorkflowAttempt(attempt)
		} else if found {
			attempt.TaskID, attempt.TaskType = existing.ID, "image"
			view, err = workflowGetImageTask(userContext, attempt.RequestID)
			if err != nil {
				return deferWorkflowAttempt(attempt)
			}
			return applyWorkflowImageView(attempt, view)
		}
		if err := requireEnabledWorkflowMember(attempt.OwnerUID); err != nil {
			return failWorkflowAttempt(attempt, err)
		}
		resolved, err := resolveWorkflowInputs(graph, node.ID, record.Outputs)
		if err != nil || resolved.State != "ready" {
			if err == nil {
				err = fmt.Errorf("workflow inputs are no longer ready")
			}
			return failWorkflowAttempt(attempt, err)
		}
		request, err := workflowImageRequest(node, resolved, attempt.RequestID)
		if err != nil {
			return failWorkflowAttempt(attempt, err)
		}
		view, err = workflowCreateImageTask(userContext, request)
		if err != nil {
			if existing, found, lookupErr := repository.GetImageGenerationTaskByClientRequest(attempt.OwnerUID, attempt.RequestID); lookupErr != nil {
				return deferWorkflowAttempt(attempt)
			} else if found {
				attempt.TaskID, attempt.TaskType = existing.ID, "image"
				return deferWorkflowAttempt(attempt)
			}
			if _, safe := err.(interface{ SafeMessage() string }); !safe {
				return deferWorkflowAttempt(attempt)
			}
			return failWorkflowAttempt(attempt, err)
		}
		attempt.TaskID, attempt.TaskType = view.ID, "image"
	} else {
		view, err = workflowGetImageTask(userContext, attempt.RequestID)
		if err != nil {
			return deferWorkflowAttempt(attempt)
		}
	}
	return applyWorkflowImageView(attempt, view)
}

func deferWorkflowAttempt(attempt model.WorkflowOutputAttempt) error {
	outputStatus := "running"
	if attempt.TaskID == "" {
		attempt.Status = "submitting"
		outputStatus = "submitting"
	} else {
		attempt.Status = "running"
	}
	attempt.Error = ""
	return repository.UpdateClaimedWorkflowAttempt(attempt, outputStatus, time.Now().UTC().Add(2*workflowPollDelay), false)
}

func workflowImageRequest(node model.WorkflowNode, inputs workflowResolvedInputs, requestID string) (CreateImageTaskRequest, error) {
	if node.Config == nil {
		return CreateImageTaskRequest{}, workflowValidationError{message: "图片节点配置无效"}
	}
	options := ai.ImageRequestOptions{}
	for key, value := range node.Config.Options {
		encoded, err := json.Marshal(value)
		if err != nil {
			return CreateImageTaskRequest{}, workflowValidationError{message: "图片节点参数无效"}
		}
		options[key] = encoded
	}
	mode := ImageTaskModeGeneration
	if len(inputs.ImageMediaIDs) > 0 {
		mode = ImageTaskModeEdit
	}
	return CreateImageTaskRequest{
		ClientRequestID: requestID, ProviderID: node.Config.ProviderID, Mode: mode,
		Request:           ai.ImageRequest{Prompt: inputs.Prompt, Count: 1, Quality: node.Config.Quality, Size: node.Config.Size, Resolution: node.Config.Resolution, OutputFormat: node.Config.OutputFormat, Background: node.Config.Background, Options: options},
		ReferenceMediaIDs: append([]string{}, inputs.ImageMediaIDs...),
	}, nil
}

func applyWorkflowImageView(attempt model.WorkflowOutputAttempt, view ImageTaskView) error {
	nextPoll := time.Now().UTC().Add(workflowPollDelay)
	switch view.Status {
	case string(model.ImageTaskSucceeded):
		if len(view.Images) != 1 || strings.TrimSpace(view.Images[0].MediaID) == "" {
			return failWorkflowAttempt(attempt, errors.New("image task succeeded without one persisted media result"))
		}
		attempt.Status, attempt.MediaID, attempt.Error = "succeeded", view.Images[0].MediaID, ""
		return repository.UpdateClaimedWorkflowAttempt(attempt, "succeeded", nextPoll, true)
	case string(model.ImageTaskFailed):
		attempt.Status, attempt.Error = "failed", strings.TrimSpace(view.Error)
		if attempt.Error == "" {
			attempt.Error = "图片生成失败"
		}
		return repository.UpdateClaimedWorkflowAttempt(attempt, "failed", nextPoll, true)
	case string(model.ImageTaskUncertain):
		attempt.Status, attempt.Error = "uncertain", strings.TrimSpace(view.Error)
		return repository.UpdateClaimedWorkflowAttempt(attempt, "uncertain", time.Now().UTC().Add(5*time.Second), false)
	default:
		attempt.Status, attempt.Error = "running", ""
		return repository.UpdateClaimedWorkflowAttempt(attempt, "running", nextPoll, false)
	}
}

func failWorkflowAttempt(attempt model.WorkflowOutputAttempt, err error) error {
	attempt.Status, attempt.Error = "failed", workflowAttemptError(err)
	return repository.UpdateClaimedWorkflowAttempt(attempt, "failed", time.Now().UTC(), true)
}

func workflowAttemptError(err error) string {
	if err == nil {
		return "生成失败"
	}
	if safe, ok := err.(interface{ SafeMessage() string }); ok {
		return safe.SafeMessage()
	}
	return "生成任务处理失败"
}
