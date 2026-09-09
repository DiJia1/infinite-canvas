import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceURL = new URL("./app-top-nav.tsx", import.meta.url);

test("top navigation returns to the Portal workbench and shows the directory name", async () => {
    const source = await readFile(sourceURL, "utf8");

    assert.match(source, /href="\/"/);
    assert.match(source, />\s*返回工作台\s*</);
    assert.doesNotMatch(source, /appPath\("\/logo\.svg"\)/);
    assert.match(source, /session\.data\?\.user\.displayName/);
});

test("top navigation replaces management with the workflow library", async () => {
    const source = await readFile(sourceURL, "utf8");

    assert.match(source, /appPath\("\/workflows"\)/);
    assert.match(source, />\s*自动化流程\s*</);
    assert.doesNotMatch(source, />\s*管理\s*</);
});
