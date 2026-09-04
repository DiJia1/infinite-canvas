import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";

import { updatePortalMemberAppRole } from "./members.ts";

test("updates one member's application-local role through the dedicated PATCH endpoint", async () => {
    const originalRequest = axios.request;
    const requests: Array<{ url?: string; method?: string; data?: unknown; headers?: unknown }> = [];
    axios.request = (async (config) => {
        requests.push(config);
        return {
            status: 200,
            data: {
                code: 0,
                data: {
                    userUid: "member-1",
                    displayName: "成员一",
                    enabled: true,
                    roles: ["portal-member"],
                    syncedAt: "2026-09-05T00:00:00Z",
                    appRole: "public_assets_manager",
                },
                msg: "ok",
            },
        } as never;
    }) as typeof axios.request;

    try {
        const member = await updatePortalMemberAppRole("member-1", "public_assets_manager");

        assert.equal(member.appRole, "public_assets_manager");
        assert.deepEqual(
            requests.map(({ url, method, data, headers }) => ({ url, method, data, headers })),
            [{ url: "/api/admin/members/member-1/app-role", method: "PATCH", data: { appRole: "public_assets_manager" }, headers: { "Content-Type": "application/json" } }],
        );
    } finally {
        axios.request = originalRequest;
    }
});
