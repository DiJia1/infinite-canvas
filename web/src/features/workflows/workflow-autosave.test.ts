import assert from "node:assert/strict";
import test from "node:test";
import { createWorkflowAutosave } from "./workflow-autosave";
import { emptyWorkflowGraph } from "./workflow-graph";
import type { WorkflowRecord } from "./types";
const doc = (name: string) => ({ name, graph: emptyWorkflowGraph() });
const record = (name: string, revision: number): WorkflowRecord => ({ id: "workflow-1", ...doc(name), revision, createdAt: "", updatedAt: "" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }

test("coalesces changes and serializes in-flight edits with the new revision", async () => {
    const first = deferred<WorkflowRecord>(); const second = deferred<WorkflowRecord>();
    const calls: Array<[string, number]> = [];
    const c = createWorkflowAutosave({ delayMs: 60_000, save: (value, revision) => { calls.push([value.name, revision]); return calls.length === 1 ? first.promise : second.promise; }, onSaved() {} });
    c.reset(doc("Initial"), 1); c.setEnabled(true); c.update(doc("Superseded")); c.update(doc("First"));
    const flushing = c.flush(); c.update(doc("Second"));
    assert.deepEqual(calls, [["First", 1]]);
    first.resolve(record("First", 2)); await Promise.resolve();
    assert.deepEqual(calls, [["First", 1], ["Second", 2]]);
    second.resolve(record("Second", 3));
    assert.equal(await flushing, 3); assert.equal(c.getState().dirty, false); c.dispose();
});

test("transient errors retain dirty data and retry only explicitly", async () => {
    let calls = 0;
    const c = createWorkflowAutosave({ save: async () => { if (++calls === 1) throw new Error("offline"); return record("Edited", 2); }, onSaved() {} });
    c.reset(doc("Initial"), 1); c.setEnabled(true); c.update(doc("Edited"));
    await assert.rejects(c.flush(), /offline/); c.update(doc("Edited")); await assert.rejects(c.flush(), /offline/);
    assert.equal(calls, 1); assert.equal(c.getState().dirty, true);
    assert.equal(await c.retry(), 2); c.dispose();
});

test("conflicts retain local edits and refuse stale revision retry", async () => {
    let calls = 0; const error = { status: 409 };
    const c = createWorkflowAutosave({ save: async () => { calls++; throw error; }, isConflict: (value) => value === error, onSaved() { assert.fail(); } });
    c.reset(doc("Initial"), 1); c.setEnabled(true); c.update(doc("Mine"));
    await assert.rejects(c.flush()); await assert.rejects(c.retry());
    assert.equal(c.getState().status, "conflict"); assert.equal(c.getState().dirty, true); assert.equal(calls, 1); c.dispose();
});

test("readonly prevents writes and disposal fences late acknowledgements", async () => {
    const pending = deferred<WorkflowRecord>(); let callbacks = 0;
    const c = createWorkflowAutosave({ save: () => pending.promise, onSaved() { callbacks++; } });
    c.reset(doc("Initial"), 1); c.update(doc("Edited")); await assert.rejects(c.flush(), /不可编辑/);
    c.setEnabled(true); const flushing = c.flush(); c.dispose(); pending.resolve(record("Edited", 2));
    await assert.rejects(flushing, /会话已变化/); assert.equal(callbacks, 0);
});

test("remote reset cannot be overwritten by an obsolete response", async () => {
    const pending = deferred<WorkflowRecord>(); let callbacks = 0;
    const c = createWorkflowAutosave({ save: () => pending.promise, onSaved() { callbacks++; } });
    c.reset(doc("Initial"), 1); c.setEnabled(true); c.update(doc("Edited")); const flushing = c.flush();
    c.reset(doc("Remote"), 4); pending.resolve(record("Edited", 2)); await assert.rejects(flushing, /会话已变化/);
    assert.equal(c.getState().revision, 4); assert.equal(c.getState().dirty, false); assert.equal(callbacks, 0); c.dispose();
});

test("empty names fail before network and remain recoverable", async () => {
    let calls = 0;
    const c = createWorkflowAutosave({ save: async () => { calls++; return record("Restored", 2); }, onSaved() {} });
    c.reset(doc("Initial"), 1); c.setEnabled(true); c.update(doc("  "));
    await assert.rejects(c.flush(), /流程名称/); assert.equal(calls, 0); c.update(doc("Restored"));
    assert.equal(await c.retry(), 2); c.dispose();
});

test("pausing an active save retains later edits and resumes without a sticky error", async () => {
    const first = deferred<WorkflowRecord>(); let calls = 0;
    const c = createWorkflowAutosave({ delayMs: 60_000, save: async (value, revision) => { calls++; return calls === 1 ? first.promise : record(value.name, revision + 1); }, onSaved() {} });
    c.reset(doc("Initial"), 1); c.setEnabled(true); c.update(doc("First")); const flushing = c.flush();
    c.update(doc("Later")); c.setEnabled(false); first.resolve(record("First", 2));
    await assert.rejects(flushing, /会话已变化/); assert.equal(calls, 1); assert.equal(c.getState().dirty, true); assert.equal(c.getState().error, undefined);
    c.setEnabled(true); assert.equal(await c.flush(), 3); assert.equal(calls, 2); c.dispose();
});

test("flush after a reset waits for obsolete I/O then saves only the current revision", async () => {
    const first = deferred<WorkflowRecord>(); const calls: number[] = [];
    const c = createWorkflowAutosave({ delayMs: 60_000, save: async (value, revision) => { calls.push(revision); return calls.length === 1 ? first.promise : record(value.name, revision + 1); }, onSaved() {} });
    c.reset(doc("Initial"), 1); c.setEnabled(true); c.update(doc("Old")); const old = c.flush();
    c.reset(doc("Remote"), 4); c.update(doc("New")); const fresh = c.flush();
    assert.deepEqual(calls, [1]); first.resolve(record("Old", 2)); await assert.rejects(old);
    assert.equal(await fresh, 5); assert.deepEqual(calls, [1, 4]); c.dispose();
});

test("StrictMode effect reactivation restores subscriptions while fencing old I/O", async () => {
    const pending = deferred<WorkflowRecord>(); let callbacks = 0; let changes = 0; let calls = 0;
    const c = createWorkflowAutosave({ delayMs: 60_000, save: async (value, revision) => { calls++; return calls === 1 ? pending.promise : record(value.name, revision + 1); }, onSaved() { callbacks++; } });
    c.reset(doc("Initial"), 1); c.setEnabled(true); c.update(doc("Old")); const old = c.flush();
    c.dispose(); c.activate(); c.subscribe(() => { changes++; });
    c.reset(doc("Reloaded"), 2); c.update(doc("Current")); const current = c.flush();
    pending.resolve(record("Old", 2)); await assert.rejects(old);
    assert.equal(await current, 3); assert.equal(callbacks, 1); assert.ok(changes > 0); c.dispose();
});
