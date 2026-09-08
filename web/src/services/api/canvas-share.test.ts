import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { shareCanvasProject } from "./canvas-share";

test("sharing has a two minute timeout and preserves partial deliveries and retry identity", async () => {
    const previous = axios.request;
    const input = { revision: 7, recipientUserUids: ["a", "b"] };
    const deliveries = [{ recipientUserUid: "a", status: "shared", projectId: "copy" }, { recipientUserUid: "b", status: "failed", message: "分享等待超时" }];
    let calls = 0;
    axios.request = (async (config) => {
        calls++;
        assert.equal(config.timeout, 120000);
        assert.deepEqual(config.data, input);
        if (calls === 1) throw new axios.AxiosError("timeout", "ECONNABORTED");
        return { status: 200, data: { code: 0, data: { deliveries } } };
    }) as typeof axios.request;
    try {
        await assert.rejects(shareCanvasProject("source", input), /结果待确认/);
        assert.deepEqual(await shareCanvasProject("source", input), { deliveries });
        assert.equal(calls, 2);
    } finally { axios.request = previous; }
});
