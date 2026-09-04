import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const drawerURL = new URL("./public-image-drawer.tsx", import.meta.url);
const capabilityURL = new URL("./use-public-asset-management-capability.ts", import.meta.url);
const sessionURL = new URL("../../../../services/api/session.ts", import.meta.url);

test("public image drawer keeps public-library mutation entry points capability-gated", async () => {
    const source = await readFile(drawerURL, "utf8");

    assert.doesNotMatch(source, /\bisAdmin\b/);
    assert.match(source, /if \(!open \|\| !canManagePublicAssets\) return;/);
    assert.match(source, /if \(!editor \|\| !canManagePublicAssets\) return;/);
    assert.match(source, /const handleFolderDrop[\s\S]*?if \(!canManagePublicAssets\) return;/);
    assert.match(source, /const movePublicImage[\s\S]*?if \(!canManagePublicAssets\) return;/);
    assert.match(source, /if \(canManagePublicAssets && file && !upload\.isPending\) upload\.mutate\(file\);/);
    assert.match(source, /onAddImage=\{canManagePublicAssets \?/);
    assert.match(source, /if \(!canManagePublicAssets \|\| \(event\.target as Element\)\.closest\("\[data-material-card], \[data-folder-id]"\)\) return;/);
    assert.match(source, /onFolderContextMenu=\{[\s\S]*?if \(!canManagePublicAssets\) return;/);
    assert.match(source, /canManagePublicAssets=\{canManagePublicAssets\}/);
    assert.match(source, /if \(canManagePublicAssets\) onImageContextMenu\(event\);/);
    assert.match(source, /open=\{canManagePublicAssets && Boolean\(editor\)\}/);
    assert.match(source, /if \(imageContextMenu && canManagePublicAssets\) remove\.mutate\(imageContextMenu\.image\.id\);/);
    assert.match(source, /if \(!folder \|\| !canManagePublicAssets\) return;/);
    assert.ok((source.match(/\{canManagePublicAssets \? \(/g) || []).length >= 4, "upload input and all three mutation context menus must be capability-gated");
});

test("public image drawer delegates fresh-opening authority to a capability hook without render-time ref writes", async () => {
    const source = await readFile(drawerURL, "utf8");

    assert.match(source, /usePublicAssetManagementCapability/);
    assert.match(source, /const canManagePublicAssets = usePublicAssetManagementCapability\(open\);/);
    assert.doesNotMatch(source, /wasOpenRef|openedAtRef/);
});

test("public asset management capability is fail-closed until the current opening has a fresh successful response", async () => {
    let capability: typeof import("./use-public-asset-management-capability");
    try {
        capability = await import(capabilityURL.href);
    } catch (error) {
        assert.fail(`public asset capability helper is missing: ${String(error)}`);
    }

    const freshAllow = {
        open: true,
        openingId: 2,
        confirmedOpeningId: 2,
        isFetching: false,
        isError: false,
        canManagePublicAssets: true,
    };

    assert.equal(capability.hasFreshPublicAssetManagementCapability({ ...freshAllow, confirmedOpeningId: 1 }), false, "cached allow from a prior opening must be ignored");
    assert.equal(capability.hasFreshPublicAssetManagementCapability({ ...freshAllow, isFetching: true }), false, "an in-flight refresh must stay readonly");
    assert.equal(capability.hasFreshPublicAssetManagementCapability({ ...freshAllow, isError: true }), false, "a failed refresh must stay readonly");
    assert.equal(capability.hasFreshPublicAssetManagementCapability({ ...freshAllow, canManagePublicAssets: false }), false, "a normal member must stay readonly");
    assert.equal(capability.hasFreshPublicAssetManagementCapability({ ...freshAllow, open: false }), false, "a closed drawer must stay readonly");
    assert.equal(capability.hasFreshPublicAssetManagementCapability(freshAllow), true, "a fresh manager response must allow management");
    assert.equal(capability.hasFreshPublicAssetManagementCapability({ ...freshAllow }), true, "a fresh admin response must allow management");
});

test("portal session exposes the public asset management capability", async () => {
    const source = await readFile(sessionURL, "utf8");

    assert.match(source, /canManagePublicAssets: boolean;/);
});

test("public drawer does not infer management authority from raw Portal role names", async () => {
    const [drawerSource, capabilitySource] = await Promise.all([readFile(drawerURL, "utf8"), readFile(capabilityURL, "utf8")]);

    assert.doesNotMatch(drawerSource, /\.roles\b|public_assets_manager|portal-public-assets-manager/);
    assert.doesNotMatch(capabilitySource, /\.roles\b|public_assets_manager|portal-public-assets-manager/);
});
