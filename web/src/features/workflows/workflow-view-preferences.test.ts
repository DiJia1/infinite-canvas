import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultWorkflowView, readWorkflowView, writeWorkflowView } from "./workflow-view-preferences";
test("view preferences isolate owner and workflow and reject invalid scales", () => {
 const map = new Map<string,string>(); const storage = { getItem: (key:string) => map.get(key) ?? null, setItem: (key:string,value:string) => { map.set(key,value); } };
 const view = { ...defaultWorkflowView, viewport: { x: -42, y: 120, k: 1.58 } };
 writeWorkflowView(storage, "user", "flow", view);
 assert.deepEqual(readWorkflowView(storage,"user","flow"),view);
 assert.deepEqual(readWorkflowView(storage,"other","flow"),defaultWorkflowView);
 assert.deepEqual(readWorkflowView(storage,"user","other"),defaultWorkflowView);
 writeWorkflowView(storage, "user", "flow", {...view, viewport:{...view.viewport,k:9}});
 assert.deepEqual(readWorkflowView(storage,"user","flow"),defaultWorkflowView);
});
