import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig, isCapabilityReady, normalizePersistedAiConfig, reconcileProviderConfig } from "./use-config-store.ts";

test("keeps a persisted upstream resolution unchanged while removing obsolete fields", () => {
    const normalized = normalizePersistedAiConfig({ model: "old", imageModel: "old-image", videoModel: "old-video", textModel: "old-text", models: ["old"], systemPrompt: "old prompt", size: "16:9", resolution: "1024x1024" });

    assert.deepEqual(normalized, { ...defaultConfig, size: "16:9", resolution: "1024x1024" });
    for (const obsoleteField of ["model", "imageModel", "videoModel", "textModel", "models", "systemPrompt"]) {
        assert.equal(obsoleteField in normalized, false);
    }
});

test("reports readiness for the requested capability only", () => {
    assert.equal(isCapabilityReady({ imageAvailable: false, imageEditable: false, videoAvailable: true }, "image"), false);
    assert.equal(isCapabilityReady({ imageAvailable: true, imageEditable: false, videoAvailable: true }, "imageEdit"), false);
    assert.equal(isCapabilityReady({ imageAvailable: true, imageEditable: true, videoAvailable: false }, "imageEdit"), true);
});

test("model reconciliation keeps a removed ratio until the user explicitly changes it", () => {
    const next = reconcileProviderConfig(
        { ...defaultConfig, size: "1:1", imageProviderType: "image", providerOptions: { size: "1:1" } },
        {
            imageAvailable: true,
            imageEditable: true,
            videoAvailable: false,
            imageProviderType: "image",
            imageRequestSchema: { version: "v2", maxReferenceImages: 0, supportsMask: false, fields: [{ key: "size", label: "比例", type: "select", required: true, default: "7:3", options: [{ value: "7:3", label: "7:3" }] }] },
        },
    );
    assert.equal(next.size, "1:1");
    assert.equal(next.providerOptions?.size, "1:1");
});
