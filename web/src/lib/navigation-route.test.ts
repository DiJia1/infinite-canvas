import assert from "node:assert/strict";
import test from "node:test";
import { navigationRoute } from "./navigation-route";

test("navigation identifies workflow editor, library and history with or without gateway mount", () => {
    for (const base of ["", "/apps/infinite-canvas"]) {
        for (const path of ["/workflows", "/workflows/w-1", "/workflow-runs", "/workflow-runs/r-1"]) {
            assert.equal(navigationRoute(base + path, base).section, "workflows");
        }
        assert.equal(navigationRoute(base + "/canvas/c-1", base).section, "canvas");
        assert.equal(navigationRoute(base + "/canvas", base).section, "canvas");
    }
    assert.notEqual(navigationRoute("/workflows-other", "").section, "workflows");
    assert.equal(navigationRoute("/apps/infinite-canvas/workflows?x=1", "/apps/infinite-canvas").path, "/workflows");
});

test("editor home targets its own library, while libraries return to the portal", () => {
    for (const base of ["", "/apps/infinite-canvas", "/apps/infinite-canvas/"]) {
        const mount = base.replace(/\/$/, "");
        for (const section of ["canvas", "workflows"]) {
            for (const suffix of ["", "/", "?view=cards", "/#list"]) {
                assert.deepEqual(navigationRoute(`${mount}/${section}${suffix}`, base).home, { label: "返回工作台", href: "/" });
            }
            for (const prefix of ["", mount]) {
                for (const suffix of ["", "/", "?from=external#node"]) {
                    assert.deepEqual(navigationRoute(`${prefix}/${section}/id-1${suffix}`, base).home, { label: "返回主页", href: `${mount}/${section}` });
                }
            }
        }
        assert.equal(navigationRoute(`${mount}/workflow-runs/run-1`, base).home.href, "/");
        assert.equal(navigationRoute(`${mount}/canvas-other/id-1`, base).home.href, "/");
    }
});
