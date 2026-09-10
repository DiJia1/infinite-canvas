"use client";

import { Dropdown, type MenuProps } from "antd";
import { Menu } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

/** Document-neutral chrome shared by Canvas and Workflow; saving remains with each editor. */
export function CanvasEditorTopBar({
    title,
    titleDraft,
    editing,
    onDraftChange,
    onStartEditing,
    onFinishEditing,
    onCancelEditing,
    menu,
    status,
    actions,
    menuLabel = "打开画布菜单",
    titleHint = "双击修改画布名称",
}: {
    title: string;
    titleDraft: string;
    editing: boolean;
    onDraftChange: (value: string) => void;
    onStartEditing: () => void;
    onFinishEditing: () => void;
    onCancelEditing: () => void;
    menu: MenuProps;
    status?: ReactNode;
    actions?: ReactNode;
    menuLabel?: string;
    titleHint?: string;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const titleRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!editing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [editing, onFinishEditing]);
    return (
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between gap-3 px-4">
            <div className="pointer-events-auto flex min-w-0 items-center gap-3">
                <Dropdown trigger={["click"]} menu={menu}>
                    <button type="button" className="grid size-9 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label={menuLabel}>
                        <Menu className="size-5" />
                    </button>
                </Dropdown>
                <div ref={titleRef} className="flex min-w-0 items-center gap-2">
                    {editing ? (
                        <input
                            autoFocus
                            aria-label="名称"
                            value={titleDraft}
                            onChange={(event) => onDraftChange(event.target.value)}
                            onBlur={onFinishEditing}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") onFinishEditing();
                                if (event.key === "Escape") onCancelEditing();
                            }}
                            className="max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                            style={{ color: theme.node.text }}
                        />
                    ) : (
                        <button type="button" className="max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current" onDoubleClick={onStartEditing} title={titleHint}>
                            {title}
                        </button>
                    )}
                    {status}
                </div>
            </div>
            {actions ? <div className="pointer-events-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
    );
}
