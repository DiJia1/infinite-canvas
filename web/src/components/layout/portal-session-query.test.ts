import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import axios from "axios";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { portalSessionQuery, type PortalSession } from "../../services/api/session.ts";

function session(uid: string): PortalSession {
    return { user: { uid, username: uid, displayName: uid, roles: [] }, appRole: "member", isAdmin: false, canManagePublicAssets: false };
}
function expression(path: string, select: (node: ts.Node) => boolean) {
    const source = ts.createSourceFile("component.tsx", readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let match: ts.Node | undefined;
    function visit(node: ts.Node) {
        if (select(node)) match = node;
        ts.forEachChild(node, visit);
    }
    visit(source);
    assert.ok(match);
    return ts.transpileModule(`const value = ${match.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText + "\nreturn value;";
}
const rootUID = expression("./client-root-init.tsx", (node) => ts.isVariableDeclaration(node) && node.name.getText() === "uid" && !!node.initializer).replace(/^const value = uid = /, "const value = ");
// Execute the actual hydration effect with its external dependencies supplied.
const hydrationEffect = expression("./client-root-init.tsx", (node) => ts.isArrowFunction(node) && node.getText().includes("let disposed = false"));
function hydrate(uid: string | undefined) {
    const seen: string[] = [];
    const effect = new Function("uid", "setImageStorageScope", "hydrateCanvas", "hydrateAssets", "retryCanvasBootstrapOnOnline", "useCanvasStore", hydrationEffect)(
        uid,
        (id: string) => seen.push(`scope:${id}`),
        async (id: string) => {
            seen.push(`canvas:${id}`);
        },
        async (id: string) => {
            seen.push(`assets:${id}`);
        },
        () => ({ dispose() {}, attempt: async () => undefined }),
        { getState: () => ({ setBootstrapRetry() {} }) },
    );
    const dispose = effect();
    dispose?.();
    return seen;
}

test("RootInit and TopNav observers share in-flight and cached session requests", async () => {
    const original = axios.defaults.adapter;
    let count = 0;
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
        release = r;
    });
    axios.defaults.adapter = async (config) => {
        count++;
        await barrier;
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: session("A") } };
    };
    const options = (path: string) =>
        new Function(
            "portalSessionQuery",
            "hideHeader",
            expression(path, (node) => !!node.parent && ts.isCallExpression(node.parent) && node.parent.expression.getText() === "useQuery" && node.parent.arguments[0] === node),
        )(portalSessionQuery, false);
    const client = new QueryClient();
    const root = new QueryObserver<PortalSession>(client, options("./client-root-init.tsx"));
    const nav = new QueryObserver<PortalSession>(client, options("./app-top-nav.tsx"));
    const stopRoot = root.subscribe(() => {});
    const stopNav = nav.subscribe(() => {});
    try {
        assert.equal(count, 1);
        assert.equal(root.getCurrentResult().isPending, true);
        release();
        await client.fetchQuery(portalSessionQuery);
        assert.equal(root.getCurrentResult().data?.user.uid, "A");
        assert.equal(nav.getCurrentResult().data?.user.uid, "A");
        await client.fetchQuery(portalSessionQuery);
        assert.equal(count, 1);
        client.setQueryData(portalSessionQuery.queryKey, session("B"));
        assert.equal(root.getCurrentResult().data?.user.uid, "B");
    } finally {
        stopRoot();
        stopNav();
        client.clear();
        axios.defaults.adapter = original;
    }
});
test("hydration uses resolved UID, waits while pending, and resets on session failure/change", () => {
    const getUID = new Function("session", rootUID);
    assert.deepEqual(hydrate(getUID({ isPending: true })), []);
    assert.deepEqual(hydrate(getUID({ data: session("A") })), ["scope:A", "canvas:A", "assets:A"]);
    assert.deepEqual(hydrate(getUID({ isError: true, data: session("A") })), ["scope:guest", "canvas:guest", "assets:guest"]);
    assert.deepEqual(hydrate(getUID({ data: session("B") })), ["scope:B", "canvas:B", "assets:B"]);
});
test("failed session request rejects instead of populating a stale session", async () => {
    const original = axios.defaults.adapter;
    axios.defaults.adapter = async () => {
        throw new Error("offline");
    };
    const client = new QueryClient();
    try {
        await assert.rejects(client.fetchQuery(portalSessionQuery));
        assert.equal(client.getQueryData(portalSessionQuery.queryKey), undefined);
    } finally {
        client.clear();
        axios.defaults.adapter = original;
    }
});
