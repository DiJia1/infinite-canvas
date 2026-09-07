import assert from "node:assert/strict";
import test from "node:test";
import { cloneElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatisticsReportTabs } from "./statistics-report-tabs";

const model = { providerId: "model-1", providerName: "测试模型", successfulCalls: 2, imageCount: 3, amount: "1.2500", unpricedImageCount: 1, resolutions: [] };
const user = { userUid: "user-1", displayName: "测试用户", successfulCalls: 2, imageCount: 3, amount: "1.2500", unpricedImageCount: 1, models: [model] };

test("statistics tabs show user consumption by default and model consumption when selected", () => {
    const tabs = StatisticsReportTabs({ users: [user], models: [model] });
    const initial = renderToStaticMarkup(tabs);
    assert.match(initial, /按用户消耗/);
    assert.match(initial, /按模型消耗/);
    assert.match(initial, /测试用户/);
    assert.match(initial, /总费用/);
    assert.match(initial, /成功图片/);
    assert.doesNotMatch(initial, /测试模型/);

    // Drive the real Ant Design Tabs active key and render the production children.
    const models = renderToStaticMarkup(cloneElement(tabs, { activeKey: "models" }));
    assert.match(models, /测试模型/);
    assert.doesNotMatch(models, /测试用户/);
    assert.match(models, /未计价图片/);
    const users = renderToStaticMarkup(cloneElement(tabs, { activeKey: "users" }));
    assert.match(users, /测试用户/);
    assert.doesNotMatch(users, /测试模型/);
});

test("statistics tabs display the corresponding empty state", () => {
    const tabs = StatisticsReportTabs({ users: [], models: [] });
    assert.match(renderToStaticMarkup(tabs), /所选时间范围暂无成功图片任务/);
    assert.match(renderToStaticMarkup(cloneElement(tabs, { activeKey: "models" })), /暂无模型消耗/);
});
