import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceURL = new URL("./page.tsx", import.meta.url);

test("operation records initialize their actor filter from a selected member", async () => {
    const source = await readFile(sourceURL, "utf8");

    assert.match(source, /useSearchParams/);
    assert.match(source, /searchParams\.get\("actor"\)/);
    assert.match(source, /查看请求参数/);
    assert.match(source, /requestSummary/);
    assert.match(source, /已提交/);
    assert.doesNotMatch(source, /OperationMediaThumbnail/);
    assert.doesNotMatch(source, /getRemoteImageAccess/);
});

test("operation records include uncertain video results in the shared filter and status labels", async () => {
    const source = await readFile(sourceURL, "utf8");
    assert.match(source, /uncertain:\s*"结果不确定"/);
    assert.match(source, /Object\.entries\(videoStatusLabels\)\.map/);
    assert.match(source, /videoStatusLabels\[item\.video\.status\]/);
});

test("media lifecycle records expose resource filtering without fetching deleted images", async () => {
    const source = await readFile(sourceURL, "utf8");
    assert.match(source, /mediaId: deferredMediaId/);
    assert.match(source, /生命周期保留 30 天/);
    assert.match(source, /media_cleanup_cancelled/);
    assert.match(source, /资源 ID：/);
    assert.doesNotMatch(source, /getRemoteImageAccess/);
});
