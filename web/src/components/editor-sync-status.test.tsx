import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorSyncStatus } from "./editor-sync-status";

test("saved and saving states use compact accessible icons and version tooltip", () => {
    const saved = renderToStaticMarkup(<EditorSyncStatus kind="saved" label="已保存" detail="流程版本 v73" />);
    assert.match(saved, /text-emerald-500/);
    assert.match(saved, /aria-label="已保存"/);
    assert.match(saved, /title="已保存 · 流程版本 v73"/);
    assert.doesNotMatch(saved, />已保存</);
    assert.match(renderToStaticMarkup(<EditorSyncStatus kind="saving" label="保存中" />), /animate-spin/);
});

test("errors show an actionable label instead of a saved indicator", () => {
    const markup = renderToStaticMarkup(<EditorSyncStatus kind="error" label="保存失败" action={{ label: "重试", onClick: () => {} }} />);
    assert.match(markup, /保存失败/);
    assert.match(markup, /重试/);
    assert.doesNotMatch(markup, /text-emerald-500/);
});
