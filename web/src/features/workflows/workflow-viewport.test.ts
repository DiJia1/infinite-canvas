import assert from "node:assert/strict";
import test from "node:test";

import { observeWorkflowViewport, type WorkflowViewportElement } from "./workflow-viewport";

test("starts viewport sizing when the editor container mounts after loading", () => {
    const sizes: Array<{ width: number; height: number }> = [];
    let observed: WorkflowViewportElement | undefined;
    let disconnected = false;
    const createObserver = (update: () => void) => ({ observe: (element: WorkflowViewportElement) => { observed = element; update(); }, disconnect: () => { disconnected = true; } });

    observeWorkflowViewport(null, (size) => sizes.push(size), createObserver)();
    const element = { clientWidth: 1280, clientHeight: 720 };
    const cleanup = observeWorkflowViewport(element, (size) => sizes.push(size), createObserver);

    assert.equal(observed, element);
    assert.deepEqual(sizes.at(-1), { width: 1280, height: 720 });
    cleanup();
    assert.equal(disconnected, true);
});
