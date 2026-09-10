import { appPath } from "./app-path";

export function navigationRoute(pathname: string, basePath = process.env.NEXT_PUBLIC_BASE_PATH || "") {
    const base = basePath.replace(/\/$/, "");
    let path = pathname.split(/[?#]/)[0];
    if (base && (path === base || path.startsWith(`${base}/`))) path = path.slice(base.length) || "/";
    const segments = path.split("/").filter(Boolean);
    const section = segments[0];
    const isEditor = segments.length === 2 && (section === "canvas" || section === "workflows");
    return {
        path,
        section: section === "workflows" || section === "workflow-runs" ? "workflows" : section,
        home: isEditor
            ? { label: "返回主页", href: appPath(`/${section}`, base) }
            : { label: "返回工作台", href: "/" },
    };
}
