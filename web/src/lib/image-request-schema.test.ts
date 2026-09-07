import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { imageRequestOptionLabel, normalizeImageRequestOptions, schemaOptionString } from "./image-request-schema";
import { imageResolutionLabel } from "@/components/image-settings-panel";

const schema = {
    version: "v1",
    maxReferenceImages: 10,
    supportsMask: false,
    fields: [
        {
            key: "resolution",
            label: "尺寸",
            type: "select" as const,
            required: false,
            default: "1k",
            options: [
                { value: "1k", label: "1K" },
                { value: "1.5k", label: "1.5K" },
            ],
        },
        { key: "watermark", label: "水印", type: "boolean" as const, required: false, default: true },
    ],
};

describe("image request schema", () => {
    test("uses provider defaults and discards stale options after a provider switch", () => {
        assert.deepEqual(normalizeImageRequestOptions(schema, { resolution: "1.5k", watermark: false, quality: "high" }), { resolution: "1.5k", watermark: false });
        assert.deepEqual(normalizeImageRequestOptions(schema, { resolution: "4k", quality: "high" }), { resolution: "1k", watermark: true });
    });

    test("reads selectable option values safely", () => {
        assert.equal(schemaOptionString({ resolution: "1.5k" }, "resolution"), "1.5k");
        assert.equal(schemaOptionString({ watermark: false }, "watermark"), "");
    });

    test("shows configured image prices beside resolution labels", () => {
        assert.equal(imageRequestOptionLabel({ value: "2k", label: "2K", price: "0.24" }), "2K · ¥0.2400");
        assert.equal(imageRequestOptionLabel({ value: "1k", label: "1K" }), "1K");
    });

    test("keeps a custom resolution label instead of falling back to 1K", () => {
        assert.equal(imageResolutionLabel("1536x1024"), "1536x1024");
    });
});
