"use client";

import { Button, Tag } from "antd";
import { Check, CloudOff, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export type EditorSyncKind = "saved" | "saving" | "offline" | "error" | "conflict" | "blocked";
const appearance = {
    saved: { color: "success", icon: <Check className="size-3" /> },
    saving: { color: "processing", icon: <LoaderCircle className="size-3 animate-spin" /> },
    offline: { color: "default", icon: <CloudOff className="size-3" /> },
    error: { color: "error", icon: <TriangleAlert className="size-3" /> },
    conflict: { color: "warning", icon: <TriangleAlert className="size-3" /> },
    blocked: { color: "default", icon: <CloudOff className="size-3" /> },
};

export function EditorSyncStatus({ kind, label, detail, action, children }: {
    kind: EditorSyncKind;
    label: string;
    detail?: string;
    action?: { label: string; onClick: () => void; loading?: boolean };
    children?: ReactNode;
}) {
    const iconOnly = kind === "saved" || kind === "saving";
    return <span className="inline-flex min-w-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
        {iconOnly ? <span aria-label={label} title={detail ? `${label} · ${detail}` : label} role="status"
            className={`inline-flex size-4 items-center justify-center ${kind === "saved" ? "text-emerald-500 dark:text-emerald-400" : "text-sky-500 dark:text-sky-400"}`}>
            {appearance[kind].icon}
        </span> : <Tag title={detail} variant="filled" color={appearance[kind].color} icon={appearance[kind].icon} className="m-0 inline-flex items-center text-xs">{label}</Tag>}
        {action ? <Button type="link" size="small" className="h-6 px-1 text-xs" loading={action.loading} onClick={action.onClick}>{action.label}</Button> : null}
        {children}
    </span>;
}
