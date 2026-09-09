import type { WorkflowGraph, WorkflowList, WorkflowRecord, WorkflowRunDetail, WorkflowRunList } from "@/features/workflows/types";
import { apiDelete, apiGet, apiPost, apiPut } from "./request";

export type CreateWorkflowInput = { name: string; graph?: WorkflowGraph };
export type UpdateWorkflowInput = { revision: number; name: string; graph: WorkflowGraph };
export type WorkflowVideoAsset = { id: string; source: "upload" | "generated"; contentType: string; bytes: number; duration: number; width: number; height: number; filename: string; title: string; createdAt: string };
export type WorkflowVideoList = { items: WorkflowVideoAsset[]; total: number };

export function fetchWorkflows(page = 1, pageSize = 60) {
    return apiGet<WorkflowList>("/api/v1/workflows", { page, pageSize });
}

export function fetchWorkflow(id: string) {
    return apiGet<WorkflowRecord>(`/api/v1/workflows/${encodeURIComponent(id)}`);
}

export function fetchWorkflowVideos() {
    return apiGet<WorkflowVideoList>("/api/v1/private-images", { kind: "video" });
}

export function createWorkflow(input: CreateWorkflowInput) {
    return apiPost<WorkflowRecord>("/api/v1/workflows", input);
}

export function updateWorkflow(id: string, input: UpdateWorkflowInput) {
    return apiPut<WorkflowRecord>(`/api/v1/workflows/${encodeURIComponent(id)}`, input);
}

export function copyWorkflow(id: string, name?: string) {
    return apiPost<WorkflowRecord>(`/api/v1/workflows/${encodeURIComponent(id)}/copy`, name ? { name } : {});
}

export async function deleteWorkflow(id: string, revision: number) {
    await apiDelete<true>(`/api/v1/workflows/${encodeURIComponent(id)}`, undefined, { revision });
}

export function createWorkflowRun(workflowId: string, requestId: string) {
    return apiPost<WorkflowRunDetail>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/runs`, { requestId });
}

export function fetchWorkflowRuns(page = 1, pageSize = 20, workflowId?: string) {
    return apiGet<WorkflowRunList>("/api/v1/workflow-runs", { page, pageSize, ...(workflowId ? { workflowId } : {}) });
}

export function fetchWorkflowRun(id: string) {
    return apiGet<WorkflowRunDetail>(`/api/v1/workflow-runs/${encodeURIComponent(id)}`);
}

export function stopWorkflowRun(id: string) {
    return apiPost<WorkflowRunDetail>(`/api/v1/workflow-runs/${encodeURIComponent(id)}/stop`);
}

export function retryWorkflowOutput(id: string, input: { requestId: string; nodeId: string; slotId: string }) {
    return apiPost<WorkflowRunDetail>(`/api/v1/workflow-runs/${encodeURIComponent(id)}/retry`, input);
}

export async function deleteWorkflowRun(id: string) {
    await apiDelete<true>(`/api/v1/workflow-runs/${encodeURIComponent(id)}`);
}
