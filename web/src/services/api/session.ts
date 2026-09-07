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

export const portalSessionQuery = {
    queryKey: ["portal-session"] as const,
    queryFn: fetchPortalSession,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: "always" as const,
};
