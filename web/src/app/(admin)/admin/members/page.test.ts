import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageURL = new URL("./page.tsx", import.meta.url);

test("member rows keep local role assignment separate from operation history navigation", async () => {
    const source = await readFile(pageURL, "utf8");

    assert.match(source, /公共素材管理员/);
    assert.match(source, /查看操作记录/);
    assert.doesNotMatch(source, /<Link[^>]*>[\s\S]*?<Select/);
});

test("role updates only disable their own selector and refresh members after success", async () => {
    const source = await readFile(pageURL, "utf8");

    assert.match(source, /mutationKey: \["portal-member-app-role", member\.userUid\]/);
    assert.match(source, /disabled=\{roleUpdate\.isPending\}/);
    assert.match(source, /await queryClient\.invalidateQueries\(\{ queryKey: \["portal-members"\] \}\)/);
});

test("role update failures report the backend message without rewriting cached members", async () => {
    const source = await readFile(pageURL, "utf8");

    assert.match(source, /onError: \(error\) => message\.error\(apiRequestError\(error, "应用角色更新失败"\)\)/);
    assert.doesNotMatch(source, /setQueryData/);
});

test("self-demotion revokes the authenticated admin session from the PATCH response without rewriting member cache", async () => {
    const source = await readFile(pageURL, "utf8");

    assert.match(source, /const adminUser = useAdminStore\(\(state\) => state\.user\)/);
    assert.match(source, /adminUID=\{adminUser\?\.id\}/);
    assert.match(source, /onSuccess: async \(updatedMember\) =>/);
    assert.match(source, /updatedMember\.userUid === adminUID && updatedMember\.appRole !== "admin"/);
    assert.match(source, /await queryClient\.invalidateQueries\(\{ queryKey: \["portal-session"\] \}\)/);
    assert.match(source, /const clearSession = useAdminStore\(\(state\) => state\.clearSession\)/);
    assert.match(source, /clearSession\(\)/);
    assert.doesNotMatch(source, /setQueryData/);
});
