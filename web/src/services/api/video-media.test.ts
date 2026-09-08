import { test } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { uploadVideoMedia, getVideoMediaAccess } from "./video-media";

test("video upload sends MP4 bytes directly to OSS and returns stable media", async () => {
    const originalPost = axios.post,
        originalFetch = globalThis.fetch;
    const events: string[] = [];
    const media = { mediaId: "video-media", url: "https://oss.example/video", duration: 5, contentType: "video/mp4", width: 1280, height: 720, bytes: 5 };
    axios.post = (async (url: string) => {
        events.push(url);
        return { data: { code: 0, data: url.endsWith("/complete") ? media : { mode: "direct", id: "upload", uploadUrl: "https://oss.example/upload" } } };
    }) as typeof axios.post;
    const file = new File(["video"], "reference.mp4", { type: "video/mp4" });
    globalThis.fetch = (async (url, init) => {
        events.push(String(url));
        assert.equal(init?.method, "PUT");
        assert.equal(init?.body, file);
        return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
        assert.deepEqual(await uploadVideoMedia(file), media);
        assert.equal(events.length, 3);
        assert.equal(events[1], "https://oss.example/upload");
    } finally {
        axios.post = originalPost;
        globalThis.fetch = originalFetch;
    }
});

test("video OSS failure does not finalize and next upload is independent", async () => {
    const originalPost = axios.post,
        originalFetch = globalThis.fetch;
    let completed = 0,
        succeeds = false;
    axios.post = (async (url: string) => {
        if (url.endsWith("/complete")) completed++;
        return { data: { code: 0, data: url.endsWith("/complete") ? { mediaId: "next" } : { mode: "direct", id: "upload", uploadUrl: "https://oss.example/upload" } } };
    }) as typeof axios.post;
    globalThis.fetch = (async () => new Response(null, { status: succeeds ? 200 : 500 })) as typeof fetch;
    try {
        const file = new File(["video"], "ref.mp4", { type: "video/mp4" });
        await assert.rejects(uploadVideoMedia(file), /上传失败/);
        assert.equal(completed, 0);
        succeeds = true;
        assert.equal((await uploadVideoMedia(file)).mediaId, "next");
        assert.equal(completed, 1);
        await assert.rejects(uploadVideoMedia(new Blob(["text"], { type: "text/plain" })), /MP4/);
    } finally {
        axios.post = originalPost;
        globalThis.fetch = originalFetch;
    }
});

test("video access forwards cancellation and rejects failed API envelope", async () => {
    const original = axios.get;
    const abort = new AbortController();
    axios.get = (async (_url, config) => {
        assert.equal(config?.signal, abort.signal);
        return { data: { code: 1, msg: "不可访问" } };
    }) as typeof axios.get;
    try {
        await assert.rejects(getVideoMediaAccess("other-user", abort.signal), /不可访问/);
    } finally {
        axios.get = original;
    }
});
