import assert from "node:assert/strict";
import test from "node:test";

import { defaultAiConfig } from "@/lib/ai-config";
import { aiConfigForWorkflowNode, workflowConfigFromAiConfig, workflowModelInputError } from "./workflow-config";
import { createWorkflowNode } from "./workflow-graph";

test("maps saved image workflow settings to the shared settings panel without URLs", () => {
    const node = createWorkflowNode("image_generation", { x: 0, y: 0 }, "image");
    node.outputs = [...node.outputs!, { ...node.outputs![0]!, id: "second" }];
    node.config = { providerId: "provider-a", size: "16:9", resolution: "2k", quality: "high", outputFormat: "png", background: "transparent", options: { style: "photo" } };
    const config = aiConfigForWorkflowNode(node, defaultAiConfig);
    assert.equal(config.imageProviderId, "provider-a");
    assert.equal(config.count, "2");
    assert.deepEqual(config.providerOptions, { style: "photo" });
    assert.equal((config as unknown as Record<string, unknown>).url, undefined);
});

test("maps shared video settings back to the workflow JSON contract", () => {
    const config = { ...defaultAiConfig, videoProviderId: "video-a", videoSize: "16:9", vquality: "1080p", videoSeconds: "8", generateAudio: "true", providerOptions: { camera: "fixed" } };
    assert.deepEqual(workflowConfigFromAiConfig("video_generation", config), {
        providerId: "video-a",
        size: "16:9",
        resolution: "1080p",
        seconds: 8,
        generateAudio: true,
        options: { camera: "fixed" },
    });
});

test("rejects switching to a model below the already connected reference counts", () => {
    const model = { id: "limited", name: "Limited", type: "image", imageRequestSchema: { version: "v1", fields: [], maxReferenceImages: 1, supportsMask: false } };
    assert.match(workflowModelInputError("image_generation", { image: 2, video: 0, text: 1 }, model), /最多支持 1 个图片输入/);
    assert.equal(workflowModelInputError("image_generation", { image: 1, video: 0, text: 8 }, model), "");
});
