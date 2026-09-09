import type { QueryClient } from "@tanstack/react-query";

import type { WorkflowGraph, WorkflowRecord } from "./types";

export type WorkflowEditorDocument = {
    name: string;
    graph: WorkflowGraph;
};

export function workflowEditorSnapshot(document: WorkflowEditorDocument) {
    return JSON.stringify(document);
}

export function remoteWorkflowEditorState(loadedWorkflowId: string, localRevision: number, dirty: boolean, remote: WorkflowRecord) {
    if (loadedWorkflowId === remote.id && (dirty || remote.revision <= localRevision)) return undefined;
    const document = { name: remote.name, graph: remote.graph };
    return { document, revision: remote.revision, savedSnapshot: workflowEditorSnapshot(document) };
}

export function workflowDetailQueryKey(workflowId: string | undefined) {
    return ["workflow", workflowId] as const;
}

export function cacheSavedWorkflow(queryClient: Pick<QueryClient, "setQueryData">, saved: WorkflowRecord) {
    queryClient.setQueryData(workflowDetailQueryKey(saved.id), saved);
}

export type WorkflowDraft = {
    revision: number;
    document: WorkflowEditorDocument;
};

type WorkflowDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const memoryDrafts = new Map<string, WorkflowDraft>();
const clearedDrafts = new Set<string>();

function workflowDraftKey(ownerUID: string, workflowId: string) {
    return `infinite-canvas:workflow-draft:${ownerUID}:${workflowId}`;
}

export function readWorkflowDraft(storage: WorkflowDraftStorage | undefined, ownerUID: string, workflowId: string): WorkflowDraft | undefined {
    const key = workflowDraftKey(ownerUID, workflowId);
    if (clearedDrafts.has(key)) return undefined;
    const fallback = memoryDrafts.get(key);
    if (fallback) return fallback;
    if (!storage) return fallback;
    try {
        const value = JSON.parse(storage.getItem(key) || "null") as Partial<WorkflowDraft> | null;
        if (!value || !Number.isInteger(value.revision) || (value.revision || 0) < 1 || typeof value.document?.name !== "string" || value.document.graph?.version !== 1 || !Array.isArray(value.document.graph.nodes) || !Array.isArray(value.document.graph.connections)) return fallback;
        return value as WorkflowDraft;
    } catch {
        return fallback;
    }
}

export function writeWorkflowDraft(storage: WorkflowDraftStorage | undefined, ownerUID: string, workflowId: string, draft: WorkflowDraft) {
    const key = workflowDraftKey(ownerUID, workflowId);
    clearedDrafts.delete(key);
    memoryDrafts.set(key, draft);
    try {
        storage?.setItem(key, JSON.stringify(draft));
    } catch {
        // The in-memory copy still protects SPA navigation when browser storage is unavailable or full.
    }
}

export function clearWorkflowDraft(storage: WorkflowDraftStorage | undefined, ownerUID: string, workflowId: string) {
    const key = workflowDraftKey(ownerUID, workflowId);
    memoryDrafts.delete(key);
    clearedDrafts.add(key);
    try {
        storage?.removeItem(key);
    } catch {
        try {
            storage?.setItem(key, "");
        } catch {
            // The in-memory tombstone prevents the stale draft from being restored during this SPA session.
        }
    }
}

export function applyWorkflowSaveResult(current: WorkflowEditorDocument, submittedSnapshot: string, saved: WorkflowRecord) {
    const savedDocument = { name: saved.name, graph: saved.graph };
    return {
        document: workflowEditorSnapshot(current) === submittedSnapshot ? savedDocument : current,
        revision: saved.revision,
        savedSnapshot: workflowEditorSnapshot(savedDocument),
    };
}
