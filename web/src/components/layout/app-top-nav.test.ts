import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceURL = new URL("./app-top-nav.tsx", import.meta.url);

test("top navigation uses the route home target and label and shows the directory name", async () => {
    const source = await readFile(sourceURL, "utf8");

    assert.match(source, /const \{ section, home \} = useNavigationRoute\(\)/);
    assert.match(source, /href=\{home\.href\}/);
    assert.match(source, />\s*\{home\.label\}\s*</);
    assert.doesNotMatch(source, /appPath\("\/logo\.svg"\)/);
    assert.match(source, /session\.data\?\.user\.displayName/);
});

test("top navigation replaces management with the workflow library", async () => {
    const source = await readFile(sourceURL, "utf8");

    assert.match(source, /appPath\("\/workflows"\)/);
    assert.match(source, />\s*自动化流程\s*</);
    assert.doesNotMatch(source, />\s*管理\s*</);
});
