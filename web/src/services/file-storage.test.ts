import assert from "node:assert/strict";
import test from "node:test";
import { createFileStorageOperations } from "./file-storage.ts";
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
function setup() {
    const blobs = new Map<string, Blob>([
        ["file:one", new Blob(["one"])],
        ["file:used", new Blob(["used"])],
    ]);
    const revoked: string[] = [];
    let gate: Promise<void> | undefined;
    let scanGate: Promise<void> | undefined;
    let fail = false;
    let serial = 0;
    const operations = createFileStorageOperations(
        {
            getItem: async (key: string) => blobs.get(key) ?? null,
            setItem: async (key: string, value: Blob) => {
                blobs.set(key, value);
                return value;
            },
            iterate: async (visit: (value: Blob, key: string) => void) => {
                for (const [key, value] of blobs) visit(value, key);
                await scanGate;
            },
            removeItem: async (key: string) => {
                await gate;
                if (fail) throw new Error("IDB failed");
                blobs.delete(key);
            },
        },
        {
            create: () => `blob:${++serial}`,
            revoke: (url) => {
                revoked.push(url);
            },
        },
    );
    return {
        ...operations,
        blobs,
        revoked,
        block: () => {
            const d = deferred();
            gate = d.promise;
            return d.resolve;
        },
        blockScan: () => {
            const d = deferred();
            scanGate = d.promise;
            return d.resolve;
        },
        fail: () => {
            fail = true;
        },
    };
}
test("successful deletion releases its URL and removes the cached lookup; repeat cleanup is idempotent", async () => {
    const s = setup();
    const old = await s.resolveMediaUrl("file:one");
    await s.cleanupUnusedMedia({ storageKey: "file:used" });
    assert.deepEqual(s.revoked, [old]);
    assert.equal(await s.resolveMediaUrl("file:one", "fallback"), "fallback");
    await s.cleanupUnusedMedia({ storageKey: "file:used" });
    assert.deepEqual(s.revoked, [old]);
    s.blobs.set("file:one", new Blob(["new"]));
    assert.notEqual(await s.resolveMediaUrl("file:one"), old);
});
test("used media keeps its URL", async () => {
    const s = setup();
    const url = await s.resolveMediaUrl("file:used");
    await s.cleanupUnusedMedia({ storageKey: "file:used" });
    assert.equal(await s.resolveMediaUrl("file:used"), url);
    assert.ok(!s.revoked.includes(url));
});
test("failed persistent deletion preserves the URL", async () => {
    const s = setup();
    const url = await s.resolveMediaUrl("file:one");
    s.fail();
    await assert.rejects(s.cleanupUnusedMedia({}), /IDB failed/);
    assert.equal(await s.resolveMediaUrl("file:one"), url);
    assert.deepEqual(s.revoked, []);
});
test("resolve during cleanup waits for removal and cannot return the released URL", async () => {
    const s = setup();
    const url = await s.resolveMediaUrl("file:one");
    const release = s.block();
    const cleanup = s.cleanupUnusedMedia({ storageKey: "file:used" });
    await Promise.resolve();
    await Promise.resolve();
    const resolved = s.resolveMediaUrl("file:one", "fallback");
    release();
    await cleanup;
    assert.equal(await resolved, "fallback");
    assert.deepEqual(s.revoked, [url]);
});

test("cleanup snapshot cannot delete or revoke a newly written and resolved URL for the same key", async () => {
    const s = setup();
    const release = s.blockScan();
    const cleanup = s.cleanupUnusedMedia({ storageKey: "file:used" });
    s.blobs.set("file:one", new Blob(["replacement"]));
    const replacement = await s.resolveMediaUrl("file:one");
    release();
    await cleanup;
    assert.equal(await s.resolveMediaUrl("file:one"), replacement);
    assert.equal(await s.blobs.get("file:one")!.text(), "replacement");
    assert.deepEqual(s.revoked, []);
});
test("concurrent cleanup calls release each URL only once", async () => {
    const s = setup();
    const url = await s.resolveMediaUrl("file:one");
    await Promise.all([s.cleanupUnusedMedia({ storageKey: "file:used" }), s.cleanupUnusedMedia({ storageKey: "file:used" })]);
    assert.deepEqual(s.revoked, [url]);
});
