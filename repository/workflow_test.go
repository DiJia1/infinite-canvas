package repository

import (
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func repositoryWorkflow(id, owner string) model.Workflow {
	return model.Workflow{
		ID: id, OwnerUID: owner, Name: id, Revision: 1,
		Graph:     model.WorkflowGraph{Version: 1, Nodes: []model.WorkflowNode{}, Connections: []model.WorkflowConnection{}},
		CreatedAt: "2026-09-09T01:00:00Z", UpdatedAt: "2026-09-09T01:00:00Z",
	}
}

func TestWorkflowRepositoryMigratesAndEnforcesOwnerRevisionAndPagination(t *testing.T) {
	useRepositoryTestDB(t, newRepositoryTestConfig(t, "workflow_repository"))
	database, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	if !database.Migrator().HasTable(&model.Workflow{}) || !database.Migrator().HasTable(&model.WorkflowMediaRef{}) || !database.Migrator().HasTable(&model.WorkflowRun{}) || !database.Migrator().HasTable(&model.WorkflowOutputAttempt{}) {
		t.Fatal("DB() did not migrate workflow definition, media, and runtime tables")
	}

	for _, item := range []model.Workflow{
		repositoryWorkflow("workflow-a", "owner-a"),
		repositoryWorkflow("workflow-b", "owner-a"),
		repositoryWorkflow("workflow-a", "owner-b"),
	} {
		if _, err := CreateWorkflow(item); err != nil {
			t.Fatalf("CreateWorkflow(%s/%s): %v", item.OwnerUID, item.ID, err)
		}
	}
	items, total, err := ListWorkflows("owner-a", 1, 1)
	if err != nil || total != 2 || len(items) != 1 {
		t.Fatalf("ListWorkflows() items=%#v total=%d err=%v", items, total, err)
	}

	updatedGraph := model.WorkflowGraph{Version: 1, Nodes: []model.WorkflowNode{{ID: "text", Type: model.WorkflowNodeTextInput, Position: model.WorkflowPoint{}, Text: "updated"}}, Connections: []model.WorkflowConnection{}}
	updated, accepted, err := UpdateWorkflow("owner-a", "workflow-a", 1, "updated", updatedGraph, "2026-09-09T02:00:00Z")
	if err != nil || !accepted || updated.Revision != 2 || updated.Name != "updated" {
		t.Fatalf("UpdateWorkflow() = %#v accepted=%t err=%v", updated, accepted, err)
	}
	if _, accepted, err := UpdateWorkflow("owner-a", "workflow-a", 1, "stale", updatedGraph, "2026-09-09T03:00:00Z"); err != nil || accepted {
		t.Fatalf("stale UpdateWorkflow() accepted=%t err=%v", accepted, err)
	}
	if _, accepted, err := UpdateWorkflow("owner-b", "workflow-b", 1, "cross-owner", updatedGraph, "2026-09-09T03:00:00Z"); err != nil || accepted {
		t.Fatalf("cross-owner UpdateWorkflow() accepted=%t err=%v", accepted, err)
	}

	deleted, err := DeleteWorkflow("owner-a", "workflow-a", 1)
	if err != nil || deleted {
		t.Fatalf("stale DeleteWorkflow() deleted=%t err=%v", deleted, err)
	}
	deleted, err = DeleteWorkflow("owner-a", "workflow-a", 2)
	if err != nil || !deleted {
		t.Fatalf("DeleteWorkflow() deleted=%t err=%v", deleted, err)
	}
	if _, found, err := GetWorkflow("owner-b", "workflow-a"); err != nil || !found {
		t.Fatalf("other owner's same workflow ID found=%t err=%v", found, err)
	}
}

func TestWorkflowGraphMediaIDsAreTrimmedAndDeduplicated(t *testing.T) {
	ids := WorkflowGraphMediaIDs(model.WorkflowGraph{Nodes: []model.WorkflowNode{
		{MediaID: " media-b "}, {MediaID: "media-a"}, {MediaID: "media-b"}, {},
	}})
	if len(ids) != 2 || ids[0] != "media-a" || ids[1] != "media-b" {
		t.Fatalf("WorkflowGraphMediaIDs() = %#v", ids)
	}
}
