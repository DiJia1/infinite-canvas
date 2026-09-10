import assert from "node:assert/strict";
import test from "node:test";
import { resizeCanvasNode } from "./canvas-resize";

test("resizing opposite corners keeps the opposite edge fixed", () => {
    const start = { x: 100, y: 80, width: 400, height: 300 };
    assert.deepEqual(resizeCanvasNode({ ...start, corner: "top-left" }, { x: 90, y: 60 }), { width: 310, height: 240, position: { x: 190, y: 140 } });
    assert.deepEqual(resizeCanvasNode({ ...start, corner: "bottom-right" }, { x: 90, y: 60 }), { width: 490, height: 360, position: { x: 100, y: 80 } });
});

test("video aspect ratio survives shrinking through either minimum", () => {
    const result = resizeCanvasNode({ x: 100, y: 80, width: 400, height: 225, corner: "top-left", keepRatio: true, ratio: 16 / 9 }, { x: 390, y: 10 });
    assert.equal(result.height, 160);
    assert.ok(Math.abs(result.width / result.height - 16 / 9) < 1e-10);
    assert.equal(result.position.x + result.width, 500);
    assert.equal(result.position.y + result.height, 305);
});

test("generation cards preserve content minimum while anchored at top right", () => {
    const result = resizeCanvasNode({ x: 100, y: 80, width: 400, height: 300, corner: "bottom-left" }, { x: 500, y: -500 }, { width: 360, height: 260 });
    assert.deepEqual(result, { width: 360, height: 260, position: { x: 140, y: 80 } });
});
