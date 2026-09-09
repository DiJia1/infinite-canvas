package service

import (
	"fmt"
	"sort"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
)

type workflowResolvedInputs struct {
	Prompt        string
	ImageMediaIDs []string
	VideoMediaIDs []string
	State         string
}

// A step only waits for connected slots; unrelated sibling outputs do not gate it.
func resolveWorkflowInputs(graph model.WorkflowGraph, nodeID string, outputs []model.WorkflowOutputExecution) (workflowResolvedInputs, error) {
	result := workflowResolvedInputs{State: "ready"}
	nodes := map[string]model.WorkflowNode{}
	for _, node := range graph.Nodes {
		nodes[node.ID] = node
	}
	if _, ok := nodes[nodeID]; !ok {
		return result, fmt.Errorf("workflow node not found")
	}
	indexed := map[string]model.WorkflowOutputExecution{}
	for _, output := range outputs {
		indexed[output.NodeID+"\x00"+output.SlotID] = output
	}
	connections := []model.WorkflowConnection{}
	for _, connection := range graph.Connections {
		if connection.TargetNodeID == nodeID {
			connections = append(connections, connection)
		}
	}
	sort.SliceStable(connections, func(i, j int) bool { return connections[i].Order < connections[j].Order })
	texts := []string{}
	for _, connection := range connections {
		source, ok := nodes[connection.SourceNodeID]
		if !ok {
			return result, fmt.Errorf("workflow input node not found")
		}
		mediaID := source.MediaID
		switch source.Type {
		case model.WorkflowNodeTextInput:
			texts = append(texts, source.Text)
			continue
		case model.WorkflowNodeImageGeneration, model.WorkflowNodeVideoGeneration:
			output, ok := indexed[source.ID+"\x00"+connection.SourceSlotID]
			if !ok {
				return result, fmt.Errorf("workflow output slot not found")
			}
			switch output.Status {
			case "succeeded":
				mediaID = output.MediaID
			case "failed", "blocked", "stopped":
				result.State = "blocked"
				continue
			default:
				if result.State != "blocked" {
					result.State = "waiting"
				}
				continue
			}
		}
		if mediaID == "" {
			return result, fmt.Errorf("workflow input media is missing")
		}
		if source.Type == model.WorkflowNodeVideoInput || source.Type == model.WorkflowNodeVideoGeneration {
			result.VideoMediaIDs = append(result.VideoMediaIDs, mediaID)
		} else {
			result.ImageMediaIDs = append(result.ImageMediaIDs, mediaID)
		}
	}
	result.Prompt = strings.Join(texts, "\n\n")
	return result, nil
}
