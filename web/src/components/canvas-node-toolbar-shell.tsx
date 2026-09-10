"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { Tooltip } from "antd";

export function CanvasNodeToolbarShell({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            {...props}
            className={`z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border border-black/10 bg-white text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)] ${props.className || "absolute"}`}
            onMouseDown={(event) => {
                event.stopPropagation();
                props.onMouseDown?.(event);
            }}
            onPointerDown={(event) => {
                if (event.button !== 1) event.stopPropagation();
                props.onPointerDown?.(event);
            }}
        >
            {children}
        </div>
    );
}

export function CanvasNodeToolbarAction({ title, label, icon, onClick, hint, active = false, disabled = false }: { title: string; label: string; icon: ReactNode; onClick?: () => void; hint?: string; active?: boolean; disabled?: boolean }) {
    return (
        <Tooltip title={hint || title} placement="top" mouseEnterDelay={0.2} getPopupContainer={() => document.body} zIndex={1070} color="#262626" styles={{ container: { color: "#ffffff" } }}>
            <button type="button" disabled={disabled} className="disabled:opacity-50 group relative flex h-12 items-center whitespace-nowrap px-1.5" onClick={onClick} aria-label={title} aria-description={hint}>
                <span className={`flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-[#f0f0f1] ${active ? "bg-[#eeeeef]" : ""}`}>
                    {icon}
                    <span>{label}</span>
                    {hint && !disabled ? <span className="text-[#a3a3a3]">{hint}</span> : null}
                </span>
            </button>
        </Tooltip>
    );
}

export function CanvasNodeToolbarIconAction({ title, icon, onClick }: { title: string; icon: ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} getPopupContainer={() => document.body} zIndex={1070} color="#262626" styles={{ container: { color: "#ffffff" } }}>
            <button type="button" className="group relative grid h-12 w-12 place-items-center px-1.5" onClick={onClick} aria-label={title}>
                <span className="grid size-9 place-items-center rounded-lg transition group-hover:bg-[#f0f0f1]">{icon}</span>
            </button>
        </Tooltip>
    );
}
