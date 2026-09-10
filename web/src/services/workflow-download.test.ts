import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { downloadWorkflowImages } from "./workflow-download";

test("download preflights once, creates one attachment target and never fetches a ZIP blob", async () => {
    const oldRequest = axios.request;
    const oldDocument = globalThis.document;
    const oldTimeout = globalThis.setTimeout;
    const frames: Array<{ src: string; hidden: boolean }> = [];
    const requests: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    axios.request = (async (config) => {
        requests.push(config);
        await gate;
        return { status: 200, data: { code: 0, data: { count: 2, filename: "结果.zip" } } } as never;
    }) as typeof axios.request;
    globalThis.document = { createElement: () => ({}), body: { appendChild: (frame: { src: string; hidden: boolean }) => frames.push(frame) } } as unknown as Document;
    globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout;
    try {
        const first = downloadWorkflowImages("run/1");
        assert.equal(await downloadWorkflowImages("run/1"), undefined);
        release();
        assert.equal(await first, 2);
        assert.equal(requests.length, 1);
        assert.equal(frames.length, 1);
        assert.equal(frames[0].src, "/api/v1/workflow-runs/run%2F1/images/download");
        assert.equal(frames[0].hidden, true);
    } finally { axios.request = oldRequest; globalThis.document = oldDocument; globalThis.setTimeout = oldTimeout; }
});

test("failed or canceled preflight never starts a browser download and permits retry", async () => {
    const oldRequest = axios.request;
    axios.request = (async () => ({ status: 403, data: { code: 1, msg: "拒绝访问" } })) as typeof axios.request;
    try {
        await assert.rejects(downloadWorkflowImages("failed"), /拒绝访问/);
        await assert.rejects(downloadWorkflowImages("failed"), /拒绝访问/);
        axios.request = (async () => ({ status: 200, data: { code: 0, data: { count: 1 } } })) as typeof axios.request;
        const controller = new AbortController(); controller.abort();
        await assert.rejects(downloadWorkflowImages("canceled", controller.signal));
    } finally { axios.request = oldRequest; }
});
