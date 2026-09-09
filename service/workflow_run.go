package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/ai"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

type CreateWorkflowRunInput struct {
	RequestID string `json:"requestId"`
}

type RetryWorkflowOutputInput struct {
	NodeID string `json:"nodeId"`
	SlotID string `json:"slotId"`
}

type WorkflowRunDetail struct {
	Run      model.WorkflowRun               `json:"run"`
	Graph    model.WorkflowGraph             `json:"graph"`
	Steps    []model.WorkflowStepExecution   `json:"steps"`
	Outputs  []model.WorkflowOutputExecution `json:"outputs"`
	Attempts []model.WorkflowOutputAttempt   `json:"attempts"`
}

type WorkflowRunList struct {
	Items    []model.WorkflowRun `json:"items"`
	Total    int64               `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"pageSize"`
}

func CreateWorkflowRun(ctx context.Context, user PortalUser, workflowID string, input CreateWorkflowRunInput) (WorkflowRunDetail, error) {
	requestID := strings.TrimSpace(input.RequestID)
	if strings.TrimSpace(user.UID) == "" || requestID == "" || len(requestID) > 128 {
		return WorkflowRunDetail{}, workflowValidationError{message: "运行请求 ID 无效"}
	}
	if existing, found, err := repository.GetWorkflowRunByRequest(user.UID, requestID); err != nil {
		return WorkflowRunDetail{}, err
	} else if found {
		return GetWorkflowRun(ctx, user, existing.ID)
	}
	if !workflowsEnabled() {
		return WorkflowRunDetail{}, workflowValidationError{message: "自动化流程运行暂不可用"}
	}
	if err := requireEnabledWorkflowMember(user.UID); err != nil {
		return WorkflowRunDetail{}, err
	}
	workflow, err := GetWorkflow(ctx, user, workflowID)
	if err != nil {
		return WorkflowRunDetail{}, err
	}
	graph, err := normalizeAndSizeWorkflowGraph(workflow.Graph)
	if err != nil {
		return WorkflowRunDetail{}, err
	}
	if err := validateWorkflowRunInputs(user.UID, graph); err != nil {
		return WorkflowRunDetail{}, err
	}
	snapshot, err := json.Marshal(graph)
	if err != nil {
		return WorkflowRunDetail{}, err
	}
	current := time.Now().UTC()
	run := model.WorkflowRun{
		ID: newID("workflow-run"), OwnerUID: user.UID, RequestID: requestID, WorkflowID: workflow.ID,
		Revision: workflow.Revision, Title: workflow.Name, Snapshot: string(snapshot), Status: "pending", StateVersion: 1,
		CreatedAt: current, UpdatedAt: current,
	}
	steps := []model.WorkflowStepExecution{}
	outputs := []model.WorkflowOutputExecution{}
	for _, node := range graph.Nodes {
		if node.Type != model.WorkflowNodeImageGeneration && node.Type != model.WorkflowNodeVideoGeneration {
			continue
		}
		steps = append(steps, model.WorkflowStepExecution{RunID: run.ID, NodeID: node.ID, Status: "waiting"})
		for _, slot := range node.Outputs {
			outputs = append(outputs, model.WorkflowOutputExecution{RunID: run.ID, NodeID: node.ID, SlotID: slot.ID, Status: "waiting", Attempt: 1, UpdatedAt: current})
		}
	}
	created, _, err := repository.CreateWorkflowRun(run, steps, outputs, workflowGraphMediaIDs(graph))
	if err != nil {
		return WorkflowRunDetail{}, workflowRepositoryError(err)
	}
	return GetWorkflowRun(ctx, user, created.ID)
}

func ListWorkflowRuns(_ context.Context, user PortalUser, page, pageSize int) (WorkflowRunList, error) {
	if strings.TrimSpace(user.UID) == "" {
		return WorkflowRunList{}, workflowValidationError{message: "未经过 Portal Gateway 身份验证"}
	}
	query := model.Query{Page: page, PageSize: pageSize}
	query.Normalize()
	items, total, err := repository.ListWorkflowRuns(user.UID, query.Page, query.PageSize)
	return WorkflowRunList{Items: items, Total: total, Page: query.Page, PageSize: query.PageSize}, err
}

func GetWorkflowRun(_ context.Context, user PortalUser, id string) (WorkflowRunDetail, error) {
	if strings.TrimSpace(user.UID) == "" {
		return WorkflowRunDetail{}, workflowValidationError{message: "未经过 Portal Gateway 身份验证"}
	}
	id, err := normalizeWorkflowPathID(id)
	if err != nil {
		return WorkflowRunDetail{}, err
	}
	record, found, err := repository.GetWorkflowRun(user.UID, id)
	if err != nil {
		return WorkflowRunDetail{}, err
	}
	if !found {
		return WorkflowRunDetail{}, safeMessageError{message: "运行记录不存在"}
	}
	var graph model.WorkflowGraph
	if err := json.Unmarshal([]byte(record.Run.Snapshot), &graph); err != nil {
		return WorkflowRunDetail{}, err
	}
	return WorkflowRunDetail{Run: record.Run, Graph: graph, Steps: record.Steps, Outputs: record.Outputs, Attempts: record.Attempts}, nil
}

func StopWorkflowRun(_ context.Context, user PortalUser, id string) (WorkflowRunDetail, error) {
	id, err := normalizeWorkflowPathID(id)
	if err != nil {
		return WorkflowRunDetail{}, err
	}
	changed, err := repository.RequestWorkflowRunStop(user.UID, id, time.Now().UTC())
	if err != nil {
		return WorkflowRunDetail{}, err
	}
	if !changed {
		if _, getErr := GetWorkflowRun(context.Background(), user, id); getErr != nil {
			return WorkflowRunDetail{}, getErr
		}
	}
	return GetWorkflowRun(context.Background(), user, id)
}

func RetryWorkflowOutput(_ context.Context, user PortalUser, id string, input RetryWorkflowOutputInput) (WorkflowRunDetail, error) {
	if !workflowsEnabled() {
		return WorkflowRunDetail{}, workflowValidationError{message: "自动化流程运行暂不可用"}
	}
	if err := requireEnabledWorkflowMember(user.UID); err != nil {
		return WorkflowRunDetail{}, err
	}
	id, err := normalizeWorkflowPathID(id)
	if err != nil {
		return WorkflowRunDetail{}, err
	}
	nodeID, slotID := strings.TrimSpace(input.NodeID), strings.TrimSpace(input.SlotID)
	if nodeID == "" || slotID == "" || len(nodeID) > 128 || len(slotID) > 128 {
		return WorkflowRunDetail{}, workflowValidationError{message: "重试槽位无效"}
	}
	if _, err := repository.RetryWorkflowOutput(user.UID, id, nodeID, slotID, time.Now().UTC()); err != nil {
		switch {
		case errors.Is(err, repository.ErrWorkflowRunNotFound):
			return WorkflowRunDetail{}, safeMessageError{message: "运行记录不存在"}
		case errors.Is(err, repository.ErrWorkflowRunActive):
			return WorkflowRunDetail{}, workflowValidationError{message: "当前槽位不可重试"}
		default:
			return WorkflowRunDetail{}, err
		}
	}
	return GetWorkflowRun(context.Background(), user, id)
}

func DeleteWorkflowRun(_ context.Context, user PortalUser, id string) error {
	id, err := normalizeWorkflowPathID(id)
	if err != nil {
		return err
	}
	err = repository.DeleteWorkflowRun(user.UID, id)
	switch {
	case errors.Is(err, repository.ErrWorkflowRunNotFound):
		return safeMessageError{message: "运行记录不存在"}
	case errors.Is(err, repository.ErrWorkflowRunActive):
		return workflowValidationError{message: "运行尚未结束，不能删除"}
	default:
		return err
	}
}

func validateWorkflowRunInputs(ownerUID string, graph model.WorkflowGraph) error {
	mediaIDs := workflowGraphMediaIDs(graph)
	if len(mediaIDs) > 0 {
		// Ownership and cleanup state are checked atomically when run refs are created.
		seen := map[string]bool{}
		for _, id := range mediaIDs {
			if strings.TrimSpace(id) == "" || seen[id] {
				return workflowValidationError{message: "流程输入素材无效"}
			}
			seen[id] = true
		}
	}
	for _, node := range graph.Nodes {
		if (node.Type != model.WorkflowNodeImageInput && node.Type != model.WorkflowNodeVideoInput) || node.MediaID == "" {
			continue
		}
		media, found, err := repository.GetMedia(node.MediaID)
		if err != nil {
			return err
		}
		if !found || media.CleanupStatus != model.MediaCleanupActive {
			return workflowValidationError{message: "流程输入素材不存在或正在删除"}
		}
		if media.OwnerUID != ownerUID {
			_, public, err := repository.GetPublicImageByMediaID(node.MediaID)
			if err != nil {
				return err
			}
			if !public || node.Type == model.WorkflowNodeVideoInput {
				return workflowValidationError{message: "无权使用流程输入素材"}
			}
		}
		if node.Type == model.WorkflowNodeImageInput && !strings.HasPrefix(media.ContentType, "image/") || node.Type == model.WorkflowNodeVideoInput && media.ContentType != "video/mp4" {
			return workflowValidationError{message: "流程输入素材类型不匹配"}
		}
	}
	validationOutputs := []model.WorkflowOutputExecution{}
	for _, node := range graph.Nodes {
		for _, slot := range node.Outputs {
			validationOutputs = append(validationOutputs, model.WorkflowOutputExecution{NodeID: node.ID, SlotID: slot.ID, Status: "succeeded", MediaID: "workflow-validation-media"})
		}
	}
	settings, err := AdminSettings()
	if err != nil {
		return err
	}
	for _, node := range graph.Nodes {
		if node.Type != model.WorkflowNodeImageGeneration && node.Type != model.WorkflowNodeVideoGeneration {
			continue
		}
		if node.Config == nil || strings.TrimSpace(node.Config.ProviderID) == "" {
			return workflowValidationError{message: "生成节点尚未选择模型"}
		}
		resolved, err := resolveWorkflowInputs(graph, node.ID, validationOutputs)
		if err != nil || resolved.State != "ready" || strings.TrimSpace(resolved.Prompt) == "" {
			return workflowValidationError{message: "生成节点输入不完整"}
		}
		switch node.Type {
		case model.WorkflowNodeImageGeneration:
			if len(resolved.VideoMediaIDs) > 0 {
				return workflowValidationError{message: "图片生成节点不支持视频输入"}
			}
			mode := ImageTaskModeGeneration
			if len(resolved.ImageMediaIDs) > 0 {
				mode = ImageTaskModeEdit
			}
			request, err := workflowImageRequest(node, resolved, "workflow-validation-request")
			if err != nil {
				return err
			}
			request.ReferenceMediaIDs = nil
			for range resolved.ImageMediaIDs {
				request.References = append(request.References, ai.ImageReference{ContentType: "image/png", Data: []byte{0x89, 'P', 'N', 'G'}})
			}
			request, err = normalizeImageTaskRequest(request)
			if err != nil {
				return workflowRunValidationError(err, "图片生成节点参数无效")
			}
			provider, err := configuredImageTaskProvider(settings.AI, mode, node.Config.ProviderID)
			if err != nil {
				return workflowRunValidationError(err, "图片模型不可用")
			}
			provider, err = validateImageTaskProvider(provider)
			if err != nil {
				return workflowRunValidationError(err, "图片模型不可用")
			}
			if _, err := normalizeImageTaskRequestForProvider(provider, request); err != nil {
				return workflowRunValidationError(err, "图片生成节点参数无效")
			}
			if _, err := imageTaskAmount(provider, request.Request.Resolution); err != nil {
				return workflowRunValidationError(err, "图片生成节点价格未配置")
			}
		case model.WorkflowNodeVideoGeneration:
			if !providerAvailable(settings.AI, node.Config.ProviderID, ai.CapabilityVideoGenerate) {
				return workflowValidationError{message: "视频模型不可用"}
			}
		}
	}
	return nil
}

func workflowRunValidationError(err error, fallback string) error {
	if err == nil {
		return nil
	}
	if safe, ok := err.(interface{ SafeMessage() string }); ok && strings.TrimSpace(safe.SafeMessage()) != "" {
		return workflowValidationError{message: safe.SafeMessage()}
	}
	return workflowValidationError{message: fallback}
}

func workflowGraphMediaIDs(graph model.WorkflowGraph) []string {
	ids := []string{}
	seen := map[string]bool{}
	for _, node := range graph.Nodes {
		if (node.Type == model.WorkflowNodeImageInput || node.Type == model.WorkflowNodeVideoInput) && node.MediaID != "" && !seen[node.MediaID] {
			ids, seen[node.MediaID] = append(ids, node.MediaID), true
		}
	}
	return ids
}

func requireEnabledWorkflowMember(uid string) error {
	member, found, err := repository.GetPortalMember(strings.TrimSpace(uid))
	if err != nil {
		return err
	}
	if !found || !member.Enabled {
		return workflowValidationError{message: "当前账号不可运行自动化流程"}
	}
	return nil
}
