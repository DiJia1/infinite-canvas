"use client";

import type { CSSProperties, HTMLAttributes, MouseEvent, PointerEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

import type { CanvasResizeCorner } from "@/lib/canvas-resize";
export type { CanvasResizeCorner } from "@/lib/canvas-resize";
export const canvasResizeCorners: CanvasResizeCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
export const canvasNodeSelectionColor = "#2f80ff";

export function CanvasNodeFrame({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
    return (
        <div {...props} className={`relative h-full w-full overflow-visible rounded-3xl border-2 ${props.className || ""}`}>
            {children}
        </div>
    );
}

export function CanvasResizeHandle({
    corner,
    onMouseDown,
    onPointerDown,
}: {
    corner: CanvasResizeCorner;
    onMouseDown?: (event: MouseEvent<HTMLDivElement>, corner: CanvasResizeCorner) => void;
    onPointerDown?: (event: PointerEvent<HTMLDivElement>, corner: CanvasResizeCorner) => void;
}) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];
    return (
        <div
            data-canvas-resize={corner}
            className={`absolute z-50 size-7 ${positionClass}`}
            onMouseDown={onMouseDown ? (event) => onMouseDown(event, corner) : undefined}
            onPointerDown={onPointerDown ? (event) => onPointerDown(event, corner) : undefined}
        />
    );
}

export function CanvasConnectionHandle({
    side,
    visible,
    label,
    onMouseDown,
    onPointerDown,
}: {
    side: "left" | "right";
    visible: boolean;
    label?: string;
    onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
    onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div
            data-canvas-connection={side}
            aria-label={label}
            className={`absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${side === "left" ? "-left-6" : "-right-6"} ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            onMouseDown={onMouseDown}
            onPointerDown={onPointerDown}
        >
            <div className="size-3 rounded-full border-2 transition-all hover:scale-125" style={{ background: theme.node.panel, borderColor: theme.node.muted }} />
        </div>
    );
}

export function CanvasInputChip({ label, value, style }: { label: string; value: string; style: CSSProperties }) {
    return (
        <div className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]" style={style}>
            <span>{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}
