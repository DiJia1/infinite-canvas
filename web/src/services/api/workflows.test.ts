import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";

import { emptyWorkflowGraph } from "@/features/workflows/workflow-graph";
import { copyWorkflow, createWorkflow, deleteWorkflow, fetchWorkflow, fetchWorkflows, fetchWorkflowVideos, updateWorkflow } from "./workflows";

test("uses the workflow definition CRUD contract including pagination and optimistic revisions", async () => {
    const originalRequest = axios.request;
    const requests: Array<{ url?: string; method?: string; params?: unknown; data?: unknown; headers?: unknown }> = [];
    axios.request = (async (config) => {
        requests.push(config);
        return { status: 200, data: { code: 0, data: config.method === "DELETE" ? true : {}, msg: "ok" } } as never;
    }) as typeof axios.request;
    const graph = emptyWorkflowGraph();

    try {
        await fetchWorkflows(2, 12);
        await fetchWorkflow("workflow/1");
        await fetchWorkflowVideos();
        await createWorkflow({ name: "新流程", graph });
        await updateWorkflow("workflow-1", { revision: 3, name: "更新流程", graph });
        await copyWorkflow("workflow-1", "流程副本");
        await deleteWorkflow("workflow-1", 4);

        assert.deepEqual(
            requests.map(({ url, method, params, data, headers }) => ({ url, method, params, data, headers })),
            [
                { url: "/api/v1/workflows", method: "GET", params: { page: 2, pageSize: 12 }, data: undefined, headers: undefined },
                { url: "/api/v1/workflows/workflow%2F1", method: "GET", params: undefined, data: undefined, headers: undefined },
                { url: "/api/v1/private-images", method: "GET", params: { kind: "video" }, data: undefined, headers: undefined },
                { url: "/api/v1/workflows", method: "POST", params: undefined, data: { name: "新流程", graph }, headers: { "Content-Type": "application/json" } },
                { url: "/api/v1/workflows/workflow-1", method: "PUT", params: undefined, data: { revision: 3, name: "更新流程", graph }, headers: { "Content-Type": "application/json" } },
                { url: "/api/v1/workflows/workflow-1/copy", method: "POST", params: undefined, data: { name: "流程副本" }, headers: { "Content-Type": "application/json" } },
                { url: "/api/v1/workflows/workflow-1", method: "DELETE", params: undefined, data: { revision: 4 }, headers: { "Content-Type": "application/json" } },
            ],
        );
    } finally {
        axios.request = originalRequest;
    }
});
