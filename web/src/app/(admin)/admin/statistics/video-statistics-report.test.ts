import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoStatisticsReport } from "./video-statistics-report";

test("video report keeps upstream currencies separate and displays task duration and output counts", () => {
    const totals = { successfulCalls: 2, videoCount: 3, seconds: 15, amount: "0.1235", upstreamCosts: { USD: "1.5", CNY: "3" } };
    const rendered = renderToStaticMarkup(VideoStatisticsReport({ data: { ...totals, models: [], users: [{ ...totals, userUid: "owner", displayName: "测试用户", models: [] }] } }));
    assert.match(rendered, /测试用户/);
    assert.match(rendered, /15 秒/);
    assert.match(rendered, /3 条/);
    assert.match(rendered, /CNY 3 · USD 1.5/);
    assert.match(rendered, /每次成功任务请求时长之和/);
    assert.doesNotMatch(rendered, /成功图片/);
});

test("video report handles empty and older image-only API responses", () => {
    assert.match(renderToStaticMarkup(VideoStatisticsReport({})), /暂无成功视频任务/);
    assert.match(renderToStaticMarkup(VideoStatisticsReport({ data: { successfulCalls: 0, videoCount: 0, seconds: 0, amount: "0", upstreamCosts: {}, models: [], users: [] } })), /暂无成功视频任务/);
});
