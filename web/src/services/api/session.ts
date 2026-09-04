import { apiGet } from "@/services/api/request";

export type PortalSession = {
    user: { uid: string; username: string; displayName: string; roles: string[] };
    appRole: "member" | "public_assets_manager" | "admin";
    isAdmin: boolean;
    canManagePublicAssets: boolean;
};

export function fetchPortalSession() {
    return apiGet<PortalSession>("/api/session");
}
