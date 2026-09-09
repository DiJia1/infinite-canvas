export type PendingWorkflowRunRequest = { workflowId: string; revision: number; requestId: string };
export type PendingWorkflowRetryRequest = { runId: string; nodeId: string; slotId: string; attempt: number; requestId: string };
type RequestStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const memoryRunRequests = new Map<string, PendingWorkflowRunRequest>();
const memoryRetryRequests = new Map<string, PendingWorkflowRetryRequest[]>();
const clearedRequestKeys = new Set<string>();

function runStorageKey(ownerUID: string, workflowId: string) {
    return `infinite-canvas:workflow-run-request:${ownerUID}:${workflowId}`;
}

function retryStorageKey(ownerUID: string, runId: string) {
    return `infinite-canvas:workflow-retry-requests:${ownerUID}:${runId}`;
}

export function pendingWorkflowRetryKey(input: Pick<PendingWorkflowRetryRequest, "runId" | "nodeId" | "slotId">) {
    return JSON.stringify([input.runId, input.nodeId, input.slotId]);
}

export function ensureWorkflowRunRequest(pending: PendingWorkflowRunRequest | undefined, workflowId: string, revision: number, createRequestId: () => string): PendingWorkflowRunRequest {
    return pending || { workflowId, revision, requestId: createRequestId() };
}

export function ensureWorkflowRetryRequest(pending: PendingWorkflowRetryRequest | undefined, input: Omit<PendingWorkflowRetryRequest, "requestId">, createRequestId: () => string): PendingWorkflowRetryRequest {
    if (pending && pending.runId === input.runId && pending.nodeId === input.nodeId && pending.slotId === input.slotId && pending.attempt === input.attempt) return pending;
    return { ...input, requestId: createRequestId() };
}

export function workflowRetryWasAccepted(pending: PendingWorkflowRetryRequest, output: { attempt: number } | undefined) {
    return Boolean(output && output.attempt > pending.attempt);
}

export function readPendingWorkflowRunRequest(storage: RequestStorage | undefined, ownerUID: string, workflowId: string) {
    const key = runStorageKey(ownerUID, workflowId);
    if (clearedRequestKeys.has(key)) return undefined;
    const memory = memoryRunRequests.get(key);
    if (memory) return memory;
    try {
        const value = JSON.parse(storage?.getItem(key) || "null") as PendingWorkflowRunRequest | null;
        if (!value || value.workflowId !== workflowId || !Number.isInteger(value.revision) || value.revision < 1 || typeof value.requestId !== "string" || !value.requestId) return undefined;
        return value;
    } catch {
        return undefined;
    }
}

export function writePendingWorkflowRunRequest(storage: RequestStorage | undefined, ownerUID: string, request: PendingWorkflowRunRequest) {
    const key = runStorageKey(ownerUID, request.workflowId);
    clearedRequestKeys.delete(key);
    memoryRunRequests.set(key, request);
    try { storage?.setItem(key, JSON.stringify(request)); } catch { /* Memory retains the id for this app session. */ }
}

export function clearPendingWorkflowRunRequest(storage: RequestStorage | undefined, ownerUID: string, workflowId: string) {
    const key = runStorageKey(ownerUID, workflowId);
    memoryRunRequests.delete(key);
    clearedRequestKeys.add(key);
    try { storage?.removeItem(key); } catch { try { storage?.setItem(key, ""); } catch { /* The memory tombstone prevents stale recovery in this app session. */ } }
}

export function readPendingWorkflowRetryRequests(storage: RequestStorage | undefined, ownerUID: string, runId: string) {
    const key = retryStorageKey(ownerUID, runId);
    if (clearedRequestKeys.has(key)) return [];
    const memory = memoryRetryRequests.get(key);
    if (memory) return memory;
    try {
        const values = JSON.parse(storage?.getItem(key) || "[]") as PendingWorkflowRetryRequest[];
        if (!Array.isArray(values)) return [];
        return values.filter((value) => value?.runId === runId && typeof value.nodeId === "string" && typeof value.slotId === "string" && Number.isInteger(value.attempt) && value.attempt > 0 && typeof value.requestId === "string" && value.requestId);
    } catch {
        return [];
    }
}

export function writePendingWorkflowRetryRequest(storage: RequestStorage | undefined, ownerUID: string, request: PendingWorkflowRetryRequest) {
    const key = retryStorageKey(ownerUID, request.runId);
    const identity = pendingWorkflowRetryKey(request);
    const values = readPendingWorkflowRetryRequests(storage, ownerUID, request.runId).filter((value) => pendingWorkflowRetryKey(value) !== identity);
    values.push(request);
    clearedRequestKeys.delete(key);
    memoryRetryRequests.set(key, values);
    try { storage?.setItem(key, JSON.stringify(values)); } catch { /* Memory retains the id for this app session. */ }
}

export function clearPendingWorkflowRetryRequest(storage: RequestStorage | undefined, ownerUID: string, request: Pick<PendingWorkflowRetryRequest, "runId" | "nodeId" | "slotId">) {
    const key = retryStorageKey(ownerUID, request.runId);
    const identity = pendingWorkflowRetryKey(request);
    const values = readPendingWorkflowRetryRequests(storage, ownerUID, request.runId).filter((value) => pendingWorkflowRetryKey(value) !== identity);
    if (values.length) {
        clearedRequestKeys.delete(key);
        memoryRetryRequests.set(key, values);
        try { storage?.setItem(key, JSON.stringify(values)); } catch { /* Memory remains authoritative for this app session. */ }
        return;
    }
    memoryRetryRequests.delete(key);
    clearedRequestKeys.add(key);
    try { storage?.removeItem(key); } catch { try { storage?.setItem(key, ""); } catch { /* The memory tombstone prevents stale recovery in this app session. */ } }
}
