import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";

import { applyWorkflowSaveResult, cacheSavedWorkflow, clearWorkflowDraft, readWorkflowDraft, remoteWorkflowEditorState, workflowDetailQueryKey, workflowEditorSnapshot, writeWorkflowDraft } from "./workflow-editor-state";
import { emptyWorkflowGraph } from "./workflow-graph";
import type { WorkflowRecord } from "./types";

function savedWorkflow(name: string, revision: number): WorkflowRecord {
    return { id: "workflow-1", name, graph: emptyWorkflowGraph(), revision, createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:01Z" };
}

test("applies the saved document when the editor did not change during the request", () => {
    const current = { name: "Submitted", graph: emptyWorkflowGraph() };
    const result = applyWorkflowSaveResult(current, workflowEditorSnapshot(current), savedWorkflow("Submitted", 2));

    assert.equal(result.document.name, "Submitted");
    assert.equal(result.revision, 2);
    assert.equal(result.savedSnapshot, workflowEditorSnapshot(result.document));
});

test("keeps edits made while a save request is pending and advances the saved revision", () => {
    const submitted = { name: "Submitted", graph: emptyWorkflowGraph() };
    const current = { name: "Edited while saving", graph: emptyWorkflowGraph() };
    const saved = savedWorkflow("Submitted", 2);
    const result = applyWorkflowSaveResult(current, workflowEditorSnapshot(submitted), saved);

    assert.equal(result.document, current);
    assert.equal(result.revision, 2);
    assert.equal(result.savedSnapshot, workflowEditorSnapshot({ name: saved.name, graph: saved.graph }));
    assert.notEqual(workflowEditorSnapshot(result.document), result.savedSnapshot);
});

test("accepts a newer initial server response without replacing dirty local edits", () => {
    assert.equal(remoteWorkflowEditorState("workflow-1", 1, false, savedWorkflow("Remote update", 3))?.document.name, "Remote update");
    assert.equal(remoteWorkflowEditorState("workflow-1", 1, true, savedWorkflow("Remote update", 3)), undefined);
    assert.equal(remoteWorkflowEditorState("workflow-1", 3, false, savedWorkflow("Same revision", 3)), undefined);
});

test("synchronizes the detail query cache after saving", () => {
    const queryClient = new QueryClient();
    const saved = savedWorkflow("Saved", 2);
    cacheSavedWorkflow(queryClient, saved);
    assert.equal(queryClient.getQueryData(workflowDetailQueryKey(saved.id)), saved);
});

test("persists and clears a recoverable workflow draft", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
    const draft = { revision: 2, document: { name: "Unsaved", graph: emptyWorkflowGraph() } };
    writeWorkflowDraft(storage, "owner-a", "workflow-1", draft);
    assert.deepEqual(readWorkflowDraft(storage, "owner-a", "workflow-1"), draft);
    assert.equal(readWorkflowDraft(storage, "owner-b", "workflow-1"), undefined);
    clearWorkflowDraft(storage, "owner-a", "workflow-1");
    assert.equal(readWorkflowDraft(storage, "owner-a", "workflow-1"), undefined);
});

test("keeps the in-memory draft when browser storage rejects a large write", () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
    const draft = { revision: 2, document: { name: "Large unsaved graph", graph: emptyWorkflowGraph() } };
    writeWorkflowDraft(storage, "owner-a", "workflow-quota", draft);
    assert.deepEqual(readWorkflowDraft(storage, "owner-a", "workflow-quota"), draft);
    clearWorkflowDraft(storage, "owner-a", "workflow-quota");
    assert.equal(readWorkflowDraft(undefined, "owner-a", "workflow-quota"), undefined);
});

test("prefers the latest in-memory draft when a later browser storage write fails", () => {
    const values = new Map<string, string>();
    let writes = 0;
    const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { if (writes++) throw new Error("quota"); values.set(key, value); }, removeItem: (key: string) => values.delete(key) };
    const first = { revision: 2, document: { name: "First", graph: emptyWorkflowGraph() } };
    const latest = { revision: 2, document: { name: "Latest", graph: emptyWorkflowGraph() } };
    writeWorkflowDraft(storage, "owner-a", "workflow-latest", first);
    writeWorkflowDraft(storage, "owner-a", "workflow-latest", latest);
    assert.deepEqual(readWorkflowDraft(storage, "owner-a", "workflow-latest"), latest);
    clearWorkflowDraft(storage, "owner-a", "workflow-latest");
});
