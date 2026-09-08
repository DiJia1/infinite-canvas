import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { canSaveNodeAsAsset } from "../components/canvas-node-actions";
import { CanvasNodeType } from "../types";

function callback(name: string, dependencies: Record<string, unknown>) {
    const source = ts.createSourceFile("canvas.tsx", readFileSync(new URL("./canvas-client-page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let expression: ts.Node | undefined;
    function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0];
        ts.forEachChild(node, visit);
    }
    visit(source);
    assert.ok(expression);
    const js = ts.transpileModule("const callback = " + expression.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(dependencies), js + ";return callback;")(...Object.values(dependencies));
}

test("saving a remote image preserves its reference without adding content to the node", async () => {
    const image = { id: "remote", type: CanvasNodeType.Image, width: 100, height: 100, metadata: { mediaId: "media-1" } };
    const saved: any[] = [];
    const messages: string[] = [];
    const save = callback("saveNodeAsset", { canSaveNodeAsAsset, canvasImageSource: () => "blob:runtime", addAsset: (asset: unknown) => saved.push(asset), getDataUrlByteSize: () => 0, message: { error: () => undefined, success: (text: string) => messages.push(text) } });
    await save(image);
    assert.equal(saved[0].metadata.mediaId, "media-1");
    assert.equal(saved[0].coverUrl, "blob:runtime");
    assert.equal(saved[0].data.dataUrl, "");
    assert.equal("content" in image.metadata, false);
    assert.equal(messages.length, 1);
});

test("downloads resolve remote and public references and propagate access failures", async () => {
    const saved: string[] = [];
    const download = callback("downloadNodeImage", {
        CanvasNodeType, resolveStoredImageReference: async () => "", loadMediaImage: async (_id: string, resolve: () => Promise<string>) => ({ url: await resolve() }),
        resolveRemoteImage: async (id: string) => { if (id === "missing") throw new Error("not found"); return "remote-url"; },
        fetchPublicImageAccess: async () => ({ url: "public-url" }), saveAs: (url: string) => saved.push(url), imageExtension: () => "png",
    });
    await download({ id: "one", type: CanvasNodeType.Image, metadata: { mediaId: "one" } });
    await download({ id: "two", type: CanvasNodeType.Image, metadata: { publicImageId: "two" } });
    assert.deepEqual(saved, ["remote-url", "public-url"]);
    await assert.rejects(download({ id: "missing", type: CanvasNodeType.Image, metadata: { mediaId: "missing" } }), /not found/);
    assert.equal(saved.length, 2);
});
