import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasNodeHoverToolbar } from "./canvas-node-hover-toolbar";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { sanitizeCanvasProjectDocument } from "@/services/canvas-project-document";
import type { CanvasProjectDocument } from "@/services/api/canvas-projects";

const noop = () => undefined;
function render(node: CanvasNodeData, imageReady = true, imageError?: string) {
    return renderToStaticMarkup(<CanvasNodeHoverToolbar node={node} imageReady={imageReady} imageError={imageError}
        viewport={{ x: 0, y: 0, k: 1 }} onKeep={noop} onLeave={noop} onEditText={noop}
        onDecreaseFont={noop} onIncreaseFont={noop} onToggleDialog={noop} onGenerateImage={noop}
        onUpload={noop} onDownload={noop} onSaveAsset={noop} onCrop={noop} onAngle={noop}
        onViewImage={noop} onMask={noop} onRetry={noop} onDelete={noop} />);
}
const image: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { mediaId: "remote" } };

test("remote image toolbar survives sanitization without persisting runtime URLs", () => {
    const document = sanitizeCanvasProjectDocument({ nodes: [{ ...image, metadata: { ...image.metadata, content: "blob:temporary" } }], connections: [], viewport: { x: 0, y: 0, k: 1 } } as unknown as CanvasProjectDocument);
    const restored = document.nodes[0];
    const markup = render(restored);
    for (const label of ["加入我的素材", "下载图片", "编辑", "替换图片", "裁剪并生成新节点", "生成角度", "查看图片详情"]) {
        assert.ok(markup.includes('aria-label="' + label + '"'), label);
    }
    assert.equal(restored.metadata?.content, undefined);
    assert.ok(!markup.includes('aria-label="上传图片"'));
});

test("loading and failed resources keep image tools but disable pixel-dependent actions", () => {
    for (const error of [undefined, "network failed"]) {
        const markup = render(image, false, error);
        assert.match(markup, /disabled=""/);
        assert.ok(markup.includes("替换图片"));
        assert.ok(markup.includes(error ? "图片加载失败" : "图片加载中"));
    }
    assert.ok(!render(image).includes('disabled=""'));
    assert.ok(render({ ...image, metadata: {} }).includes('aria-label="上传图片"'));
});
