"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navigationRoute } from "@/lib/navigation-route";

export function useNavigationRoute() {
    const pathname = usePathname();
    const [actualPath, setActualPath] = useState(pathname);
    useEffect(() => {
        // Next commits history after rendering. Read the mounted browser path
        // after that commit; reading during render can retain the previous URL.
        const update = () => setActualPath(window.location.pathname);
        update();
        window.addEventListener("popstate", update);
        return () => window.removeEventListener("popstate", update);
    }, [pathname]);
    return navigationRoute(actualPath);
}
