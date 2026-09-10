import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { sourceBehavior } from "@/test-utils/source-behavior";

const page = new URL("./canvas-client-page.tsx", import.meta.url);

for (const paused of [true, false]) {
    test(`stable editor changes still publish while history is ${paused ? "paused" : "applying"}`, () => {
        const writes: unknown[] = [];
        const nodes = [{ id: "A" }, { id: "B" }];
        const connections = [{ fromNodeId: "A", toNodeId: "B" }];
        const callback = sourceBehavior(page, {
            projectLoaded: true, loadedCanonicalGeneration: 1, canonicalGeneration: 1,
            isProjectReadonly: false, isPausedRef: { current: paused }, isApplyingRef: { current: !paused },
            canonicalProjectSaveGenerationRef: { current: null }, projectId: "project-1",
            nodes, connections, maskResources: {}, backgroundMode: "lines", showImageInfo: false,
            updateProject: (_id: string, document: unknown) => writes.push(document),
        }).select((node) => ts.isArrowFunction(node) && ts.isCallExpression(node.parent) && node.parent.expression.getText() === "useEffect" &&
            node.getText().includes("updateProject(projectId, { nodes,"));
        callback();
        assert.equal(writes.length, 1, "history recording must not gate document persistence");
        assert.deepEqual((writes[0] as { nodes: unknown }).nodes, nodes);
        assert.deepEqual((writes[0] as { connections: unknown }).connections, connections);
    });
}
