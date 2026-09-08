import test from "node:test";
import assert from "node:assert/strict";
import { CanvasNode } from "./canvas-node";

test("video visibility changes invalidate the memoized canvas node", () => {
    const compare = (CanvasNode as unknown as { compare: (a: object, b: object) => boolean }).compare;
    const data = { id: "video", type: "video" };
    assert.equal(compare({ data, videoVisible: true }, { data, videoVisible: false }), false);
    assert.equal(compare({ data, videoVisible: false }, { data, videoVisible: false }), true);
});
