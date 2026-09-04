import { apiGet, apiPatch } from "@/services/api/request";

export type AppRole = "member" | "public_assets_manager" | "admin";

export type PortalMember = {
    userUid: string;
    displayName: string;
    enabled: boolean;
    roles: string[];
    syncedAt: string;
    appRole: AppRole;
};

export type PortalMemberList = {
    items: PortalMember[];
    total: number;
};

export function fetchPortalMembers(query: { page?: number; pageSize?: number; query?: string } = {}) {
    return apiGet<PortalMemberList>("/api/admin/members", query);
}

export function updatePortalMemberAppRole(userUID: string, appRole: AppRole) {
    return apiPatch<PortalMember>(`/api/admin/members/${encodeURIComponent(userUID)}/app-role`, { appRole });
}
