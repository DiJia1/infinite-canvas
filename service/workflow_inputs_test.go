package service

import (
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestWorkflowInputsWaitOnlyForConnectedSlots(t *testing.T) {
	graph := model.WorkflowGraph{Nodes: []model.WorkflowNode{{ID: "source", Type: model.WorkflowNodeImageGeneration}, {ID: "target", Type: model.WorkflowNodeVideoGeneration}, {ID: "text1", Type: model.WorkflowNodeTextInput, Text: "first"}, {ID: "text2", Type: model.WorkflowNodeTextInput, Text: "second"}}, Connections: []model.WorkflowConnection{{SourceNodeID: "source", SourceSlotID: "a", TargetNodeID: "target", Order: 2}, {SourceNodeID: "text2", TargetNodeID: "target", Order: 1}, {SourceNodeID: "text1", TargetNodeID: "target", Order: 0}}}
	outputs := []model.WorkflowOutputExecution{{NodeID: "source", SlotID: "a", Status: "succeeded", MediaID: "image"}, {NodeID: "source", SlotID: "b", Status: "failed"}}
	result, err := resolveWorkflowInputs(graph, "target", outputs)
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "ready" || result.Prompt != "first\n\nsecond" || len(result.ImageMediaIDs) != 1 || result.ImageMediaIDs[0] != "image" {
		t.Fatalf("unexpected inputs: %+v", result)
	}
	graph.Connections = append(graph.Connections, model.WorkflowConnection{SourceNodeID: "source", SourceSlotID: "b", TargetNodeID: "target", Order: 3})
	result, err = resolveWorkflowInputs(graph, "target", outputs)
	if err != nil || result.State != "blocked" {
		t.Fatalf("merge should block: %+v %v", result, err)
	}
	outputs[1].Status = "uncertain"
	result, err = resolveWorkflowInputs(graph, "target", outputs)
	if err != nil || result.State != "waiting" {
		t.Fatalf("uncertain must wait: %+v %v", result, err)
	}
	outputs[1].Status = "succeeded"
	outputs[1].MediaID = "retry-result"
	result, err = resolveWorkflowInputs(graph, "target", outputs)
	if err != nil || result.State != "ready" || len(result.ImageMediaIDs) != 2 {
		t.Fatalf("retry should unblock: %+v %v", result, err)
	}
}

func TestWorkflowInputsPreserveMediaOrderAndTypes(t *testing.T) {
	graph := model.WorkflowGraph{
		Nodes: []model.WorkflowNode{
			{ID: "target", Type: model.WorkflowNodeVideoGeneration},
			{ID: "image", Type: model.WorkflowNodeImageInput, MediaID: "reference"},
			{ID: "video", Type: model.WorkflowNodeVideoInput, MediaID: "clip"},
			{ID: "generated", Type: model.WorkflowNodeImageGeneration},
		},
		Connections: []model.WorkflowConnection{
			{SourceNodeID: "generated", SourceSlotID: "slot", TargetNodeID: "target", Order: 3},
			{SourceNodeID: "video", TargetNodeID: "target", Order: 2},
			{SourceNodeID: "image", TargetNodeID: "target", Order: 0},
		},
	}
	result, err := resolveWorkflowInputs(graph, "target", []model.WorkflowOutputExecution{{NodeID: "generated", SlotID: "slot", Status: "succeeded", MediaID: "result"}})
	if err != nil || result.State != "ready" || len(result.ImageMediaIDs) != 2 || result.ImageMediaIDs[0] != "reference" || result.ImageMediaIDs[1] != "result" || len(result.VideoMediaIDs) != 1 || result.VideoMediaIDs[0] != "clip" {
		t.Fatalf("media order/type lost: %+v %v", result, err)
	}
}

func TestWorkflowInputsRejectMissingResources(t *testing.T) {
	graph := model.WorkflowGraph{
		Nodes:       []model.WorkflowNode{{ID: "target", Type: model.WorkflowNodeImageGeneration}, {ID: "source", Type: model.WorkflowNodeImageInput}},
		Connections: []model.WorkflowConnection{{SourceNodeID: "source", TargetNodeID: "target"}},
	}
	if _, err := resolveWorkflowInputs(graph, "target", nil); err == nil {
		t.Fatal("missing input media accepted")
	}
	graph.Nodes[1].Type = model.WorkflowNodeImageGeneration
	if _, err := resolveWorkflowInputs(graph, "target", nil); err == nil {
		t.Fatal("missing output slot accepted")
	}
	if _, err := resolveWorkflowInputs(graph, "target", []model.WorkflowOutputExecution{{NodeID: "source", Status: "succeeded"}}); err == nil {
		t.Fatal("successful output without media accepted")
	}
}
