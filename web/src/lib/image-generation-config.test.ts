import assert from "node:assert/strict";
import test from "node:test";

import { imageAspectOptions } from "./image-generation-config.ts";

test("offers widescreen 16:9 and ultrawide 21:9 aspect ratios", () => {
    assert.deepEqual(
        imageAspectOptions.filter((item) => item.value === "16:9" || item.value === "21:9").map((item) => item.value),
        ["16:9", "21:9"],
    );
});
