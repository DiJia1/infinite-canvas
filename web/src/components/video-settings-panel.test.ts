import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { sourceBehavior } from "@/test-utils/source-behavior";

test("audio switch preserves string booleans consumed by video request serialization", () => {
    const changes: unknown[] = [];
    const update = sourceBehavior(new URL("./video-settings-panel.tsx", import.meta.url), { onConfigChange: (...args: unknown[]) => changes.push(args) }).select(
        (node) => ts.isArrowFunction(node) && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) && node.parent.parent.name.getText() === "onChange" && node.getText().includes('"generateAudio"'),
    );
    update(true);
    update(false);
    assert.deepEqual(changes, [
        ["generateAudio", "true"],
        ["generateAudio", "false"],
    ]);
});
