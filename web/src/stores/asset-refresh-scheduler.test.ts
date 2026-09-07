import assert from "node:assert/strict";
import test from "node:test";
import { createAssetRefreshScheduler } from "./asset-refresh-scheduler.ts";
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
async function flush() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}
function setup() {
    const timers = new Set<() => void>();
    const requests: ReturnType<typeof deferred<string>>[] = [];
    const writes: string[] = [];
    const cleanups: string[] = [];
    const scheduler = createAssetRefreshScheduler({
        schedule: (callback) => {
            timers.add(callback);
            return () => {
                timers.delete(callback);
            };
        },
        load: () => {
            const request = deferred<string>();
            requests.push(request);
            return request.promise;
        },
        commit: async (value, isCurrent) => {
            if (isCurrent()) {
                writes.push(value);
                cleanups.push(value);
            }
        },
    });
    return {
        ...scheduler,
        requests,
        writes,
        cleanups,
        tick: () => {
            const pending = [...timers];
            timers.clear();
            pending.forEach((callback) => callback());
        },
    };
}
test("twenty completion notifications share one remote refresh", async () => {
    const s = setup();
    const calls = Array.from({ length: 20 }, () => s.refresh());
    assert.equal(s.requests.length, 0);
    s.tick();
    assert.equal(s.requests.length, 1);
    s.requests[0]!.resolve("catalog");
    await Promise.all(calls);
    assert.deepEqual(s.writes, ["catalog"]);
});
test("running and trailing calls wait for the round covering their changes", async () => {
    const s = setup();
    const first = s.refresh();
    s.tick();
    let secondDone = false;
    const second = s.refresh().then(() => {
        secondDone = true;
    });
    s.requests[0]!.resolve("stale");
    await flush();
    s.tick();
    assert.equal(secondDone, false);
    assert.deepEqual(s.cleanups, []);
    assert.equal(s.requests.length, 2);
    const third = s.refresh();
    s.requests[1]!.resolve("also stale");
    await flush();
    s.tick();
    assert.equal(s.requests.length, 3);
    assert.equal(secondDone, false);
    s.requests[2]!.resolve("latest");
    await Promise.all([first, second, third]);
    assert.deepEqual(s.writes, ["latest"]);
});
for (const transitions of [1, 2])
    test(`scope replacement (${transitions}) discards old responses and cleanup after newer completion`, async () => {
        const s = setup();
        const old = s.refresh();
        const cancelled = assert.rejects(old, { name: "AbortError" });
        s.tick();
        for (let i = 0; i < transitions; i++) s.reset().resume();
        const current = s.refresh();
        s.tick();
        s.requests[1]!.resolve("new session");
        await current;
        s.requests[0]!.resolve("old session");
        await flush();
        await cancelled;
        assert.deepEqual(s.writes, ["new session"]);
        assert.deepEqual(s.cleanups, ["new session"]);
    });
test("local hydration gates remote refresh", async () => {
    const s = setup();
    const hydration = s.reset();
    const refresh = s.refresh();
    s.tick();
    assert.equal(s.requests.length, 0);
    hydration.resume();
    s.tick();
    s.requests[0]!.resolve("remote");
    await refresh;
    assert.deepEqual(s.writes, ["remote"]);
});
test("obsolete hydration cannot resume the new scope", async () => {
    const s = setup();
    const old = s.reset();
    const current = s.reset();
    old.resume();
    assert.equal(old.isCurrent(), false);
    const refresh = s.refresh();
    s.tick();
    assert.equal(s.requests.length, 0);
    current.resume();
    s.tick();
    s.requests[0]!.resolve("current");
    await refresh;
});
for (const pending of [false, true])
    test(`failure permits ${pending ? "pending" : "later"} refresh`, async () => {
        const s = setup();
        const first = s.refresh();
        const failed = assert.rejects(first, /network/);
        s.tick();
        let next = pending ? s.refresh() : undefined;
        s.requests[0]!.reject(new Error("network"));
        await failed;
        await flush();
        assert.deepEqual(s.writes, []);
        next ??= s.refresh();
        s.tick();
        assert.equal(s.requests.length, 2);
        s.requests[1]!.resolve("recovered");
        await next;
        assert.deepEqual(s.writes, ["recovered"]);
        await flush();
        s.tick();
        assert.equal(s.requests.length, 2);
    });
