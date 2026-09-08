import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { downloadVideo } from "./video-download";

test("remote download uses an attachment request and hidden iframe without fetching video bytes", async () => {
    const get = axios.get,
        documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document"),
        timer = globalThis.setTimeout;
    const frame = { hidden: false, title: "", src: "", remove() {} };
    let appended = 0;
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement: (tag: string) => {
                assert.equal(tag, "iframe");
                return frame;
            },
            body: {
                appendChild: (value: unknown) => {
                    assert.equal(value, frame);
                    appended++;
                },
            },
        },
    });
    globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout;
    axios.get = (async (_url, config) => {
        assert.deepEqual(config?.params, { download: "1", filename: "canvas-video-v.mp4" });
        return { data: { code: 0, data: { url: "https://oss.example/download" } } };
    }) as typeof axios.get;
    try {
        await downloadVideo("media", undefined, "canvas-video-v.mp4");
        assert.equal(frame.src, "https://oss.example/download");
        assert.equal(frame.hidden, true);
        assert.equal(appended, 1);
        axios.get = (async () => ({ data: { code: 1, msg: "无权访问" } })) as typeof axios.get;
        await assert.rejects(downloadVideo("media", undefined, "video.mp4"), /无权访问/);
        assert.equal(appended, 1);
    } finally {
        axios.get = get;
        globalThis.setTimeout = timer;
        if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
        else Reflect.deleteProperty(globalThis, "document");
    }
});
