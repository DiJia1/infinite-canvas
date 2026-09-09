package router

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/ai"
	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/shopspring/decimal"
)

const workflowRouteProviderType = "workflow-route-image-provider"

var registerWorkflowRouteProvider sync.Once

type workflowRouteImageProvider struct{}

func (workflowRouteImageProvider) CreateImageTask(context.Context, ai.ImageTaskRequest) (ai.ImageTask, error) {
	return ai.ImageTask{}, errors.New("route tests must not call a supplier")
}
func (workflowRouteImageProvider) GetImageTask(context.Context, string) (ai.ImageTask, error) {
	return ai.ImageTask{}, errors.New("route tests must not call a supplier")
}
func (workflowRouteImageProvider) SummarizeImageTaskRequest(ai.ImageTaskRequest) (ai.ImageTaskRequestSummary, error) {
	return ai.ImageTaskRequestSummary{}, nil
}
func (workflowRouteImageProvider) NormalizeImageTaskRequest(request ai.ImageTaskRequest) (ai.ImageTaskRequest, error) {
	if len(request.References) > 2 {
		return ai.ImageTaskRequest{}, errors.New("最多支持 2 张参考图")
	}
	if request.Request.Resolution != "1k" {
		return ai.ImageTaskRequest{}, errors.New("不支持该分辨率")
	}
	return request, nil
}

func TestWorkflowRunRoutesAreIdempotentOwnerScopedAndProtectActiveRuns(t *testing.T) {
	restore := configureWorkflowRouteRuntime(t)
	defer restore()
	owner := "workflow-run-owner-" + time.Now().Format("150405.000000000")
	other := "other-" + owner
	seedRouteWorkflowMember(t, owner, true)
	seedRouteWorkflowMember(t, other, true)
	workflowID := createRouteWorkflow(t, owner, "1k")

	start := workflowRequest(http.MethodPost, "/api/v1/workflows/"+workflowID+"/runs", owner, `{"requestId":"same-start-request"}`)
	if start.Code != http.StatusOK || workflowResponse(t, start).Code != 0 {
		t.Fatalf("start run = %d/%s", start.Code, start.Body.String())
	}
	var created struct {
		Run model.WorkflowRun `json:"run"`
	}
	if err := json.Unmarshal(workflowResponse(t, start).Data, &created); err != nil || created.Run.ID == "" {
		t.Fatalf("decode run = %#v, %v", created, err)
	}
	duplicate := workflowRequest(http.MethodPost, "/api/v1/workflows/"+workflowID+"/runs", owner, `{"requestId":"same-start-request"}`)
	var repeated struct {
		Run model.WorkflowRun `json:"run"`
	}
	if duplicate.Code != http.StatusOK || json.Unmarshal(workflowResponse(t, duplicate).Data, &repeated) != nil || repeated.Run.ID != created.Run.ID {
		t.Fatalf("duplicate start = %d/%s decoded=%#v", duplicate.Code, duplicate.Body.String(), repeated)
	}
	secondWorkflowID := createRouteWorkflow(t, owner, "1k")
	mismatched := workflowRequest(http.MethodPost, "/api/v1/workflows/"+secondWorkflowID+"/runs", owner, `{"requestId":"same-start-request"}`)
	if mismatched.Code != http.StatusBadRequest || workflowResponse(t, mismatched).Code != 1 {
		t.Fatalf("cross-workflow idempotency key = %d/%s", mismatched.Code, mismatched.Body.String())
	}

	for _, request := range []*httptest.ResponseRecorder{
		workflowRequest(http.MethodGet, "/api/v1/workflow-runs/"+created.Run.ID, other, ""),
		workflowRequest(http.MethodPost, "/api/v1/workflow-runs/"+created.Run.ID+"/stop", other, ""),
		workflowRequest(http.MethodPost, "/api/v1/workflow-runs/"+created.Run.ID+"/retry", other, `{"requestId":"other-retry","nodeId":"generate","slotId":"slot"}`),
		workflowRequest(http.MethodDelete, "/api/v1/workflow-runs/"+created.Run.ID, other, ""),
	} {
		if workflowResponse(t, request).Code != 1 {
			t.Fatalf("cross-owner run request was accepted: %d/%s", request.Code, request.Body.String())
		}
	}
	database, _ := repository.DB()
	if err := database.Model(&model.WorkflowOutputExecution{}).Where("run_id = ?", created.Run.ID).Updates(map[string]any{"status": "failed", "error": "明确失败"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Model(&model.WorkflowRun{}).Where("id = ?", created.Run.ID).Update("status", "failed").Error; err != nil {
		t.Fatal(err)
	}
	retryBody := `{"requestId":"retry-once","nodeId":"generate","slotId":"slot"}`
	for attempt := 0; attempt < 2; attempt++ {
		retry := workflowRequest(http.MethodPost, "/api/v1/workflow-runs/"+created.Run.ID+"/retry", owner, retryBody)
		var detail struct {
			Outputs []model.WorkflowOutputExecution `json:"outputs"`
		}
		if retry.Code != http.StatusOK || json.Unmarshal(workflowResponse(t, retry).Data, &detail) != nil || len(detail.Outputs) != 1 || detail.Outputs[0].Attempt != 2 {
			t.Fatalf("retry attempt %d = %d/%s decoded=%#v", attempt+1, retry.Code, retry.Body.String(), detail)
		}
	}
	activeDelete := workflowRequest(http.MethodDelete, "/api/v1/workflow-runs/"+created.Run.ID, owner, "")
	if activeDelete.Code != http.StatusBadRequest || workflowResponse(t, activeDelete).Code != 1 {
		t.Fatalf("active delete = %d/%s", activeDelete.Code, activeDelete.Body.String())
	}
	stop := workflowRequest(http.MethodPost, "/api/v1/workflow-runs/"+created.Run.ID+"/stop", owner, "")
	if stop.Code != http.StatusOK || workflowResponse(t, stop).Code != 0 {
		t.Fatalf("stop run = %d/%s", stop.Code, stop.Body.String())
	}
	list := workflowRequest(http.MethodGet, "/api/v1/workflow-runs?page=1&pageSize=10", owner, "")
	if list.Code != http.StatusOK || workflowResponse(t, list).Code != 0 {
		t.Fatalf("list runs = %d/%s", list.Code, list.Body.String())
	}
	if err := database.Model(&model.WorkflowRun{}).Where("id = ?", created.Run.ID).Updates(map[string]any{"status": "stopped", "finished_at": time.Now().UTC()}).Error; err != nil {
		t.Fatal(err)
	}
	deleted := workflowRequest(http.MethodDelete, "/api/v1/workflow-runs/"+created.Run.ID, owner, "")
	if deleted.Code != http.StatusOK || workflowResponse(t, deleted).Code != 0 {
		t.Fatalf("delete terminal run = %d/%s", deleted.Code, deleted.Body.String())
	}
}

func TestWorkflowRunRoutesRejectDisabledExecutionAndInvalidWholeGraphParameters(t *testing.T) {
	restore := configureWorkflowRouteRuntime(t)
	defer restore()
	stamp := time.Now().Format("150405.000000000")
	owner := "workflow-preflight-" + stamp
	seedRouteWorkflowMember(t, owner, true)
	invalidWorkflow := createRouteWorkflow(t, owner, "unsupported")
	invalid := workflowRequest(http.MethodPost, "/api/v1/workflows/"+invalidWorkflow+"/runs", owner, `{"requestId":"invalid-parameters"}`)
	if invalid.Code != http.StatusBadRequest || workflowResponse(t, invalid).Code != 1 {
		t.Fatalf("invalid whole graph start = %d/%s", invalid.Code, invalid.Body.String())
	}

	validWorkflow := createRouteWorkflow(t, owner, "1k")
	config.Cfg.WorkflowEnabled = false
	disabled := workflowRequest(http.MethodPost, "/api/v1/workflows/"+validWorkflow+"/runs", owner, `{"requestId":"feature-disabled"}`)
	if disabled.Code != http.StatusBadRequest || workflowResponse(t, disabled).Code != 1 {
		t.Fatalf("disabled feature start = %d/%s", disabled.Code, disabled.Body.String())
	}
	config.Cfg.WorkflowEnabled = true
	disabledOwner := "disabled-" + owner
	seedRouteWorkflowMember(t, disabledOwner, false)
	disabledOwnerWorkflow := createRouteWorkflow(t, disabledOwner, "1k")
	memberResponse := workflowRequest(http.MethodPost, "/api/v1/workflows/"+disabledOwnerWorkflow+"/runs", disabledOwner, `{"requestId":"disabled-member"}`)
	if memberResponse.Code != http.StatusBadRequest || workflowResponse(t, memberResponse).Code != 1 {
		t.Fatalf("disabled member start = %d/%s", memberResponse.Code, memberResponse.Body.String())
	}
}

func TestWorkflowRunConcurrentRequestIDCannotCrossWorkflows(t *testing.T) {
	restore := configureWorkflowRouteRuntime(t)
	defer restore()
	owner := "workflow-concurrent-owner-" + time.Now().Format("150405.000000000")
	seedRouteWorkflowMember(t, owner, true)
	workflowIDs := []string{createRouteWorkflow(t, owner, "1k"), createRouteWorkflow(t, owner, "1k")}
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, len(workflowIDs))
	var workers sync.WaitGroup
	for _, workflowID := range workflowIDs {
		workflowID := workflowID
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			responses <- workflowRequest(http.MethodPost, "/api/v1/workflows/"+workflowID+"/runs", owner, `{"requestId":"concurrent-cross-workflow"}`)
		}()
	}
	close(start)
	workers.Wait()
	close(responses)

	successes := 0
	conflicts := 0
	for response := range responses {
		payload := workflowResponse(t, response)
		switch {
		case response.Code == http.StatusOK && payload.Code == 0:
			successes++
		case response.Code == http.StatusBadRequest && payload.Code == 1:
			conflicts++
		default:
			t.Fatalf("unexpected concurrent start response = %d/%s", response.Code, response.Body.String())
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent starts: successes=%d conflicts=%d", successes, conflicts)
	}
}

func configureWorkflowRouteRuntime(t *testing.T) func() {
	t.Helper()
	registerWorkflowRouteProvider.Do(func() {
		_ = ai.Register(ai.ProviderType{
			ID: workflowRouteProviderType, Name: "Workflow route provider",
			Capabilities:       []ai.Capability{ai.CapabilityImageGenerate, ai.CapabilityImageEdit},
			ImageRequestSchema: &ai.ImageRequestSchema{Version: "v1", MaxReferenceImages: 2},
			New:                func(json.RawMessage) (ai.Provider, error) { return workflowRouteImageProvider{}, nil },
		})
	})
	previousConfig := config.Cfg
	previousSettings, err := repository.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	config.Cfg.WorkflowEnabled = true
	config.Cfg.WorkflowGlobalConcurrency = 4
	config.Cfg.WorkflowRunConcurrency = 2
	settings := model.Settings{AI: model.AISettings{ImageProviderID: "workflow-route-provider", Providers: []model.AIProvider{{
		ID: "workflow-route-provider", Name: "Workflow route provider", Type: workflowRouteProviderType, Enabled: true,
		Config: json.RawMessage(`{}`), ImagePrices: []model.ImageResolutionPrice{{Resolution: "1k", Amount: decimal.RequireFromString("0.01")}},
	}}}}
	if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	return func() {
		config.Cfg = previousConfig
		_, _ = repository.SaveSettings(previousSettings, time.Now().UTC().Format(time.RFC3339Nano))
	}
}

func seedRouteWorkflowMember(t *testing.T, uid string, enabled bool) {
	t.Helper()
	database, _ := repository.DB()
	if err := database.Create(&model.PortalMember{UserUID: uid, DisplayName: uid, Enabled: enabled, SyncedAt: time.Now().UTC()}).Error; err != nil {
		t.Fatal(err)
	}
}

func createRouteWorkflow(t *testing.T, owner, resolution string) string {
	t.Helper()
	body := `{"name":"运行流程","graph":{"version":1,"nodes":[{"id":"prompt","type":"text_input","position":{"x":0,"y":0},"text":"生成产品图"},{"id":"generate","type":"image_generation","position":{"x":200,"y":0},"inputPorts":[{"id":"prompt","type":"text"}],"config":{"providerId":"workflow-route-provider","resolution":"` + resolution + `"},"outputs":[{"id":"slot","type":"image"}]}],"connections":[{"sourceNodeId":"prompt","sourceSlotId":"output","targetNodeId":"generate","targetPortId":"prompt","order":0}]}}`
	response := workflowRequest(http.MethodPost, "/api/v1/workflows", owner, body)
	var workflow model.Workflow
	if response.Code != http.StatusOK || json.Unmarshal(workflowResponse(t, response).Data, &workflow) != nil || workflow.ID == "" {
		t.Fatalf("create route workflow = %d/%s", response.Code, response.Body.String())
	}
	return workflow.ID
}
