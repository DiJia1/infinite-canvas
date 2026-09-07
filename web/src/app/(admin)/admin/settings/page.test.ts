import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageURL = new URL("./page.tsx", import.meta.url);

test("provider price rules use manual resolution inputs and always add blank rows", async () => {
    const source = await readFile(pageURL, "utf8");

    assert.match(source, /placeholder="例如：2K 或 2048x1152"/);
    assert.match(source, /onClick=\{\(\) => add\(\{ resolution: "", amount: "" \}\)\}/);
    assert.doesNotMatch(source, /disabled=\{fields\.length >= resolutionOptions\.length\}/);
});

test("image defaults exclude providers without a manually configured price rule and tolerate legacy null prices", async () => {
    const source = await readFile(pageURL, "utf8");

    assert.match(source, /return !supportsImagePricing\(types, provider\.type\) \|\| \(provider\.imagePrices \|\| \[\]\)\.length > 0/);
});
