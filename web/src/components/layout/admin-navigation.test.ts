import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adminNavigationItems } from "./admin-navigation";

const sourceURL = new URL("./admin-navigation.ts", import.meta.url);

test("administrator navigation exposes the same management destinations", () => {
    assert.deepEqual(
        adminNavigationItems.map((item) => item.href),
        ["/admin/members", "/admin/operations", "/admin/statistics", "/admin/settings"],
    );
});

test("administrator navigation does not contain Portal role gates", async () => {
    const source = await readFile(sourceURL, "utf8");

    assert.doesNotMatch(source, /portal-admin|portal-public-assets-manager/);
});
