"use client";

import { Image as ImageIcon, RefreshCw, Video } from "lucide-react";

import { CanvasVideoContent } from "@/app/(user)/canvas/components/canvas-video-content";

export function WorkflowMediaPreview({ nodeId, mediaId, type, visible = true, imageUrl, imageStorageKey, imageError, onRetryImage, onImageLoaded, onChoose }: { nodeId: string; mediaId?: string; type: "image" | "video"; visible?: boolean; imageUrl?: string; imageStorageKey?: string; imageError?: string; onRetryImage?: () => void; onImageLoaded?: (storageKey: string) => void; onChoose?: () => void }) {
    if (!mediaId) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-xs opacity-55">
                {type === "image" ? <ImageIcon className="size-7" /> : <Video className="size-7" />}
                <button type="button" className="rounded-md border px-2 py-1" onClick={onChoose} onPointerDown={(event) => event.stopPropagation()}>选择或上传</button>
            </div>
        );
    }
    if (type === "video") return <CanvasVideoContent nodeId={nodeId} mediaId={mediaId} visible={visible} />;
    if (imageError) {
        return (
            <button type="button" className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-red-400" onClick={onRetryImage} onPointerDown={(event) => event.stopPropagation()}>
                <RefreshCw className="size-4" />
                {imageError}
            </button>
        );
    }
    if (!imageUrl) return <div className="h-full w-full animate-pulse bg-black/10 dark:bg-white/10" />;
    return <img src={imageUrl} alt="" draggable={false} className="pointer-events-none h-full w-full object-contain" onLoad={() => imageStorageKey && onImageLoaded?.(imageStorageKey)} />;
}
