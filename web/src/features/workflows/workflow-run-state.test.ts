import assert from "node:assert/strict";
import test from "node:test";

import { findCompatibleWorkflowOutput, findWorkflowOutput, isRetryableImageOutput, isWorkflowRunActive, latestWorkflowRun, workflowOutputKey, workflowOutputResourceNodeId, workflowRunStatusText } from "./workflow-run-state";
import type { WorkflowGraph, WorkflowOutputExecution, WorkflowOutputSlot, WorkflowRun } from "./types";

const run = (id: string, workflowId: string, status: WorkflowRun["status"], createdAt: string): WorkflowRun => ({ id, workflowId, status, createdAt, updatedAt: createdAt, requestId: `${id}-request`, revision: 1, title: id, stopRequested: false });
const output = (status: WorkflowOutputExecution["status"]): WorkflowOutputExecution => ({ runId: "run-1", nodeId: "node-1", slotId: "slot-1", status, attempt: 1, updatedAt: "2026-09-09T00:00:00Z" });

test("classifies open runs and explains uncertain recovery", () => {
    for (const status of ["pending", "running", "stopping", "attention_required"] as const) assert.equal(isWorkflowRunActive(status), true);
    for (const status of ["completed", "partially_completed", "failed", "stopped"] as const) assert.equal(isWorkflowRunActive(status), false);
    assert.match(workflowRunStatusText("attention_required"), /恢复原任务/);
});

test("selects the latest run for one workflow without mixing deleted definitions", () => {
    const items = [run("other", "workflow-2", "running", "2026-09-09T03:00:00Z"), run("new", "workflow-1", "failed", "2026-09-09T02:00:00Z"), run("old", "workflow-1", "completed", "2026-09-09T01:00:00Z")];
    assert.equal(latestWorkflowRun(items, "workflow-1")?.id, "new");
    assert.equal(latestWorkflowRun(items, "missing"), undefined);
});

test("identifies outputs by node and slot and only retries failed image outputs", () => {
    const outputs = [output("failed"), { ...output("succeeded"), nodeId: "node-2" }];
    assert.equal(workflowOutputKey("node-1", "slot-1"), JSON.stringify(["node-1", "slot-1"]));
    assert.equal(findWorkflowOutput(outputs, "node-2", "slot-1")?.status, "succeeded");
    const image: WorkflowOutputSlot = { id: "slot-1", type: "image" };
    const video: WorkflowOutputSlot = { id: "slot-1", type: "video" };
    assert.equal(isRetryableImageOutput(image, output("failed"), run("run-1", "workflow-1", "failed", "2026-09-09T00:00:00Z")), true);
    assert.equal(isRetryableImageOutput(video, output("failed"), run("run-1", "workflow-1", "failed", "2026-09-09T00:00:00Z")), false);
    assert.equal(isRetryableImageOutput(image, output("uncertain"), run("run-1", "workflow-1", "attention_required", "2026-09-09T00:00:00Z")), false);
    assert.equal(isRetryableImageOutput(image, output("failed"), { ...run("run-1", "workflow-1", "stopped", "2026-09-09T00:00:00Z"), stopRequested: true }), false);
});

test("keeps legal identifiers with colons collision free", () => {
    assert.notEqual(workflowOutputKey("a:b", "c"), workflowOutputKey("a", "b:c"));
    assert.notEqual(workflowOutputResourceNodeId("run", "a:b", "c"), workflowOutputResourceNodeId("run", "a", "b:c"));
});


test("mode switching cannot render an old image result as video", () => {
    const graph: WorkflowGraph = { version: 1, nodes: [{ id: "node-1", type: "image_generation", position: {x:0,y:0}, inputPorts: [], outputs: [{id:"slot-1",type:"image"}] }], connections: [] };
    const result = { graph, outputs: [output("succeeded")] };
    assert.equal(findCompatibleWorkflowOutput(result, graph, "node-1", "slot-1")?.status, "succeeded");
    const changed: WorkflowGraph = { ...graph, nodes: [{ ...graph.nodes[0], type:"video_generation", outputs:[{id:"slot-1",type:"video"}] }] };
    assert.equal(findCompatibleWorkflowOutput(result, changed, "node-1", "slot-1"), undefined);
    assert.equal(result.outputs[0].status, "succeeded");
});

test("download counts successful image slots from run snapshot, excluding inputs and old attempts", async () => {
    const { workflowDownloadImageCount } = await import("./workflow-run-state");
    const detail = {
        graph: { version: 1, nodes: [
            { id: "input", type: "image_input", mediaId: "input", position: { x: 0, y: 0 } },
            { id: "gen", type: "image_generation", position: { x: 0, y: 0 }, outputs: [{ id: "ok", type: "image" }, { id: "failed", type: "image" }, { id: "loading", type: "image" }] },
            { id: "video", type: "video_generation", position: { x: 0, y: 0 }, outputs: [{ id: "ok", type: "video" }] },
        ], connections: [] },
        outputs: [
            { nodeId: "gen", slotId: "ok", status: "succeeded", mediaId: "latest" },
            { nodeId: "gen", slotId: "failed", status: "failed", mediaId: "old" },
            { nodeId: "gen", slotId: "loading", status: "running" },
            { nodeId: "video", slotId: "ok", status: "succeeded", mediaId: "video" },
        ],
    } as unknown as Parameters<typeof workflowDownloadImageCount>[0];
    assert.equal(workflowDownloadImageCount(detail), 1);
    assert.equal(workflowDownloadImageCount(undefined), 0);
});
