import assert from "node:assert/strict";
import ts from "typescript";
import test from "node:test";
import { sourceBehavior } from "@/test-utils/source-behavior";

const pageURL = new URL("./page.tsx", import.meta.url);

test("adding provider price rules always produces independent blank rows", () => {
    const rows: unknown[] = [];
    const add = sourceBehavior(pageURL, { add: (row: unknown) => rows.push(row) }).select((node) => ts.isArrowFunction(node) && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) && node.parent.parent.name.getText() === "onClick" && node.getText().includes("add("));
    add();
    add();
    assert.deepEqual(rows, [{ resolution: "", amount: "" }, { resolution: "", amount: "" }]);
    assert.notEqual(rows[0], rows[1]);
});

test("default provider selection uses actual capabilities and configured image prices", () => {
    const supportsImagePricing = sourceBehavior(pageURL).named("supportsImagePricing");
    const supports = sourceBehavior(pageURL, { supportsImagePricing }).named("supports");
    const types = [
        { id: "image", capabilities: ["image_generate"] },
        { id: "edit", capabilities: ["image_edit"] },
        { id: "video", capabilities: ["video_generate"] },
        { id: "hybrid", capabilities: ["image_generate", "video_generate"] },
    ];
    const providers = [
        { id: "missing", type: "image" },
        { id: "null", type: "image", imagePrices: null },
        { id: "empty", type: "image", imagePrices: [] },
        { id: "priced", type: "image", imagePrices: [{ resolution: "2K", amount: "0.125" }] },
        { id: "edit", type: "edit", imagePrices: [{ resolution: "2K", amount: "1" }] },
        { id: "video", type: "video" },
        { id: "hybrid", type: "hybrid", imagePrices: [] },
        { id: "unknown", type: "unknown", imagePrices: [{ resolution: "2K", amount: "1" }] },
    ];
    for (const id of ["missing", "null", "empty", "unknown", "absent", "video", "edit", "hybrid"]) {
        assert.equal(supports(types, providers, id, "image_generate"), false, id);
    }
    assert.equal(supports(types, providers, "priced", "image_generate"), true);
    assert.equal(supports(types, providers, "edit", "image_edit"), true);
    assert.equal(supports(types, providers, "video", "video_generate"), true);
    assert.equal(supports(types, providers, "priced", "video_generate"), false);
    assert.equal(supports(types, providers, "hybrid", "video_generate"), false, "image-capable providers still require pricing");
});
