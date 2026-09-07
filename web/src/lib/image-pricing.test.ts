import assert from "node:assert/strict";
import { test } from "node:test";

import { formatImagePrices, isImageResolutionInput } from "./image-pricing";

test("formats manually configured resolution prices in their configured order", () => {
    assert.equal(
        formatImagePrices([
            { resolution: "2048x1152", amount: "0.24" },
            { resolution: "2K", amount: "0.12" },
        ]),
        "2048x1152 ¥0.2400 · 2K ¥0.1200",
    );
    assert.equal(formatImagePrices([]), "—");
});

test("accepts manually configured upstream resolution parameters", () => {
    assert.equal(isImageResolutionInput("2K"), true);
    assert.equal(isImageResolutionInput("2048x1152"), true);
    assert.equal(isImageResolutionInput(""), false);
    assert.equal(isImageResolutionInput("2K\ninvalid"), false);
    assert.equal(isImageResolutionInput("x".repeat(65)), false);
});
