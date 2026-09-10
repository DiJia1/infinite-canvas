import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowImageAssetCard } from "./workflow-image-asset-card";

test("a media-ID-only asset starts with a loading state instead of an empty image src", () => {
    const html = renderToStaticMarkup(<WorkflowImageAssetCard mediaId="media-only" title="我的图片" onSelect={() => { throw new Error("render must not select"); }} />);
    assert.match(html, /正在加载缩略图/);
    assert.match(html, /aria-label="我的图片"/);
    assert.doesNotMatch(html, /<img/);
});
