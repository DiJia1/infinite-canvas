import type { WorkflowGraph, WorkflowList, WorkflowRecord } from "@/features/workflows/types";
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
