import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adminNavigationItems } from "./admin-navigation";

const sourceURL = new URL("./app-top-nav.tsx", import.meta.url);

test("top navigation returns to the Portal workbench and shows the directory name", async () => {
    const source = await readFile(sourceURL, "utf8");

    assert.match(source, /href="\/"/);
    assert.match(source, />\s*返回工作台\s*</);
    assert.doesNotMatch(source, /appPath\("\/logo\.svg"\)/);
    assert.match(source, /session\.data\?\.user\.displayName/);
});

test("management navigation has one complete shared destination list", () => {
	assert.deepEqual(
		adminNavigationItems.map((item) => item.href),
		["/admin/members", "/admin/operations", "/admin/statistics", "/admin/settings"],
	);
});

test("management navigation relies on the local session capability, not raw Portal roles", async () => {
    const source = await readFile(sourceURL, "utf8");

    assert.match(source, /session\.data\?\.isAdmin/);
    assert.doesNotMatch(source, /session\.data\?\.user\.roles|portal-admin|portal-public-assets-manager/);
});
