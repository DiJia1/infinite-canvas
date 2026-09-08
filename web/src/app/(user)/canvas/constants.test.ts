import assert from "node:assert/strict";
import test from "node:test";
import { getNodeSpec, normalizeVideoConfigNodeSize } from "./constants";
import { CanvasNodeType, type CanvasNodeData } from "./types";

const legacy: CanvasNodeData = { id: "config", type: CanvasNodeType.Config, title: "Config", position: { x: 127, y: -42 }, width: 340, height: 240, metadata: { generationMode: "video", videoProviderId: "chosen" } };

test("new configuration nodes use 360 by 260 without changing image defaults", () => {
    assert.deepEqual({ width: getNodeSpec(CanvasNodeType.Config).width, height: getNodeSpec(CanvasNodeType.Config).height }, { width: 360, height: 260 });
    assert.deepEqual({ width: getNodeSpec(CanvasNodeType.Image).width, height: getNodeSpec(CanvasNodeType.Image).height }, { width: 340, height: 240 });
});

test("restored video config nodes grow only undersized axes and preserve position and metadata", () => {
    const restored = normalizeVideoConfigNodeSize(legacy);
    assert.equal(restored.width, 340);
    assert.equal(restored.height, 260);
    assert.equal(restored.position, legacy.position);
    assert.equal(restored.metadata, legacy.metadata);
    assert.equal(legacy.height, 240);
    const wide = normalizeVideoConfigNodeSize({ ...legacy, width: 520 });
    assert.equal(wide.width, 520);
    assert.equal(wide.height, 260);
    const tall = normalizeVideoConfigNodeSize({ ...legacy, width: 250, height: 460 });
    assert.equal(tall.width, 340);
    assert.equal(tall.height, 460);
});

test("switching back to image never shrinks a grown config node", () => {
    const grown = normalizeVideoConfigNodeSize(legacy);
    const image = { ...grown, metadata: { ...grown.metadata, generationMode: "image" as const } };
    assert.equal(normalizeVideoConfigNodeSize(image), image);
    const oldImage = { ...legacy, metadata: { generationMode: "image" as const } };
    assert.equal(normalizeVideoConfigNodeSize(oldImage), oldImage);
});

test("normalization preserves identity for sufficient config sizes and non-config video nodes", () => {
    const large = { ...legacy, width: 520, height: 400 };
    assert.equal(normalizeVideoConfigNodeSize(large), large);
    const video = { ...legacy, type: CanvasNodeType.Video };
    assert.equal(normalizeVideoConfigNodeSize(video), video);
});
