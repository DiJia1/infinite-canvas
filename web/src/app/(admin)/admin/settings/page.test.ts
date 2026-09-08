import assert from "node:assert/strict";
import ts from "typescript";
import test from "node:test";
import { sourceBehavior } from "@/test-utils/source-behavior";

const pageURL = new URL("./page.tsx", import.meta.url);

test("adding provider price rules always produces independent blank rows", () => {
    const rows: unknown[] = [];
    let matched = false;
    const add = sourceBehavior(pageURL, { add: (row: unknown) => rows.push(row) }).select(
        (node) => ts.isArrowFunction(node) && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) && node.parent.parent.name.getText() === "onClick" && node.getText().includes("add(") && !matched && (matched = true),
    );
    add();
    add();
    assert.deepEqual(rows, [
        { resolution: "", amount: "" },
        { resolution: "", amount: "" },
    ]);
    assert.notEqual(rows[0], rows[1]);
});

test("default provider selection uses actual capabilities and configured image prices", () => {
    const supportsImagePricing = sourceBehavior(pageURL).named("supportsImagePricing");
    const supportsAspectRatios = sourceBehavior(pageURL).named("supportsAspectRatios");
    const supports = sourceBehavior(pageURL, { supportsImagePricing, supportsAspectRatios }).named("supports");
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
        { id: "priced", type: "image", aspectRatios: ["16:9"], imagePrices: [{ resolution: "2K", amount: "0.125" }] },
        { id: "edit", type: "edit", aspectRatios: ["1:1"], imagePrices: [{ resolution: "2K", amount: "1" }] },
        { id: "video", type: "video", videoPrices: [{ resolution: "720p", amount: "0.1" }], aspectRatios: ["16:9"] },
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

test("image providers require explicit ratios except Seedream 5 Pro", () => {
    const supportsImagePricing = sourceBehavior(pageURL).named("supportsImagePricing");
    const supportsAspectRatios = sourceBehavior(pageURL).named("supportsAspectRatios");
    const supports = sourceBehavior(pageURL, { supportsImagePricing, supportsAspectRatios }).named("supports");
    const types = ["gpt-image", "doubao-seedream-5-pro"].map((id) => ({ id, capabilities: ["image_generate"] }));
    const providers = types.map((type) => ({ id: type.id, type: type.id, imagePrices: [{ resolution: "2K", amount: "1" }] }));
    assert.equal(supports(types, providers, "gpt-image", "image_generate"), false);
    assert.equal(supports(types, providers, "doubao-seedream-5-pro", "image_generate"), true);
});

test("image and video tabs scope both types and provider lists", () => {
    const supportsImagePricing = sourceBehavior(pageURL).named("supportsImagePricing");
    const types = [
        { id: "image", capabilities: ["image_generate"] },
        { id: "video", capabilities: ["video_generate"] },
    ];
    const providers = types.map((type) => ({ id: `${type.id}-instance`, type: type.id }));
    for (const activeTab of ["image", "video"]) {
        const scopedTypes = sourceBehavior(pageURL, { types, activeTab, supportsImagePricing }).named("scopedTypes");
        const scopedProviders = sourceBehavior(pageURL, { providers, scopedTypes }).named("scopedProviders");
        assert.deepEqual(
            scopedTypes.map((item: { id: string }) => item.id),
            [activeTab],
        );
        assert.deepEqual(
            scopedProviders.map((item: { id: string }) => item.id),
            [`${activeTab}-instance`],
        );
        let formValue: { type?: string } = {};
        const openEditor = sourceBehavior(pageURL, {
            scopedTypes,
            setEditingId: () => {},
            setDrawerOpen: () => {},
            nanoid: () => "new-provider",
            form: {
                resetFields: () => {},
                setFieldsValue: (value: { type?: string }) => {
                    formValue = value;
                },
            },
        }).named("openEditor");
        openEditor();
        assert.equal(formValue.type, activeTab);
    }
});


test("aspect ratio validation matches the backend four-digit limit", async () => {
    const validate = sourceBehavior(pageURL).select(
        (node) => ts.isArrowFunction(node) && ts.isPropertyAssignment(node.parent) && node.parent.name.getText() === "validator" && node.getText().includes("auto|"),
    );
    for (const value of ["auto", "16:9", "9999:1", "1:9999"]) await validate(undefined, value);
    for (const value of ["10000:1", "1:10000", "0:1", "01:1"]) await assert.rejects(validate(undefined, value));
});
