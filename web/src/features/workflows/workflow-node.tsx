"use client";

import { Button } from "antd";
import { Image as ImageIcon, RefreshCw, Trash2, Upload, Video } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { WorkflowGenerationConfig, WorkflowNode, WorkflowOutputSlot } from "./types";
import { WorkflowConfigPanel } from "./workflow-config-panel";
import { WorkflowMediaPreview } from "./workflow-media-preview";

export type WorkflowPreviewInput = { key: string; sourceNodeId: string; type: "image" | "video" | "text"; text?: string; mediaId?: string; imageUrl?: string; imageStorageKey?: string; imageError?: string };

export function WorkflowNodeCard({ node, selected, connecting, videoVisible, inputs, imageUrl, imageStorageKey, imageError, onRetryImage, onImageLoaded, onSelect, onDragStart, onRemove, onChooseMedia, onTextChange, onConfigChange, onOutputCountChange, onPreview, onConnectTarget, onStartSource }: {
    node: WorkflowNode;
    selected: boolean;
    connecting: boolean;
    videoVisible?: boolean;
    inputs: WorkflowPreviewInput[];
    imageUrl?: string;
    imageStorageKey?: string;
    imageError?: string;
    onRetryImage: () => void;
    onImageLoaded: (storageKey: string) => void;
    onSelect: () => void;
    onDragStart: (event: ReactPointerEvent, node: WorkflowNode) => void;
    onRemove: () => void;
    onChooseMedia: () => void;
    onTextChange: (value: string) => void;
    onConfigChange: (config: WorkflowGenerationConfig) => void;
    onOutputCountChange: (count: number) => void;
    onPreview: () => void;
    onConnectTarget: () => void;
    onStartSource: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = node.width || 340;
    const height = node.height || 240;
    const generation = node.type === "image_generation" || node.type === "video_generation";
    const mediaType = node.type === "image_input" ? "image" : node.type === "video_input" ? "video" : undefined;
    return (
        <div
            data-workflow-object
            data-node-id={node.id}
            className="absolute group"
            style={{ left: node.position.x, top: node.position.y, width, height }}
            onPointerDown={(event) => onDragStart(event, node)}
            onClick={(event) => { event.stopPropagation(); onSelect(); }}
        >
            <div className="relative h-full w-full overflow-hidden rounded-3xl border shadow-[0_14px_34px_rgba(68,64,60,.12)]" style={{ background: theme.node.panel, borderColor: selected ? theme.node.activeStroke : theme.node.stroke, color: theme.node.text }}>
                {node.type === "text_input" ? (
                    <textarea
                        aria-label="流程文本输入"
                        value={node.text || ""}
                        placeholder="输入提示词"
                        className="thin-scrollbar h-full w-full resize-none border-none bg-transparent p-4 font-mono text-sm leading-6 outline-none"
                        onChange={(event) => onTextChange(event.target.value)}
                        onPointerDown={(event) => event.stopPropagation()}
                    />
                ) : mediaType ? (
                    <WorkflowMediaPreview nodeId={node.id} type={mediaType} mediaId={node.mediaId} visible={videoVisible} imageUrl={imageUrl} imageStorageKey={imageStorageKey} imageError={imageError} onRetryImage={onRetryImage} onImageLoaded={onImageLoaded} onChoose={onChooseMedia} />
                ) : generation ? (
                    <WorkflowConfigPanel node={node} inputs={inputs} onConfigChange={onConfigChange} onOutputCountChange={onOutputCountChange} onPreview={onPreview} />
                ) : null}
            </div>
            {selected ? (
                <div className="absolute -top-10 right-1 z-40 flex gap-1 rounded-lg border p-0.5 shadow-sm" style={{ background: theme.node.panel, borderColor: theme.node.stroke }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                    {mediaType ? <Button type="text" size="small" shape="circle" icon={<Upload className="size-3.5" />} onClick={onChooseMedia} aria-label="替换素材" /> : null}
                    <Button danger type="text" size="small" shape="circle" icon={<Trash2 className="size-3.5" />} onClick={onRemove} aria-label="删除节点" />
                </div>
            ) : null}
            {generation ? (
                <button type="button" aria-label="连接到生成配置" className={`absolute left-0 top-1/2 z-30 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center ${connecting ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onConnectTarget(); }}>
                    <span className="size-3 rounded-full border-2" style={{ background: theme.node.panel, borderColor: theme.node.muted }} />
                </button>
            ) : (
                <button type="button" aria-label="开始连接" className="absolute right-0 top-1/2 z-30 flex size-10 translate-x-1/2 -translate-y-1/2 items-center justify-center opacity-0 group-hover:opacity-100" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onStartSource(); }}>
                    <span className="size-3 rounded-full border-2" style={{ background: theme.node.panel, borderColor: theme.node.muted }} />
                </button>
            )}
        </div>
    );
}

export function WorkflowOutputCard({ parent, slot, selected, onSelect, onDragStart, onRemove, onStartSource }: {
    parent: WorkflowNode;
    slot: WorkflowOutputSlot;
    selected: boolean;
    onSelect: () => void;
    onDragStart: (event: ReactPointerEvent, parent: WorkflowNode, slot: WorkflowOutputSlot) => void;
    onRemove: () => void;
    onStartSource: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const position = slot.position || { x: parent.position.x + (parent.width || 360) + 96, y: parent.position.y };
    return (
        <div data-workflow-object className="group absolute" style={{ left: position.x, top: position.y, width: slot.width || (slot.type === "image" ? 340 : 420), height: slot.height || (slot.type === "image" ? 240 : 236) }} onPointerDown={(event) => onDragStart(event, parent, slot)} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-3xl border shadow-[0_14px_34px_rgba(68,64,60,.12)]" style={{ background: theme.node.panel, borderColor: selected ? theme.node.activeStroke : theme.node.stroke, color: theme.node.placeholder }}>
                <div className="flex flex-col items-center gap-3 text-xs opacity-55">
                    {slot.type === "image" ? <ImageIcon className="size-7" /> : <Video className="size-7" />}
                    等待运行结果
                </div>
                {slot.type === "image" ? <Button type="text" size="small" disabled icon={<RefreshCw className="size-3.5" />} className="!absolute !bottom-2 !right-2" title="运行结果失败后可重试">重试</Button> : null}
                {selected ? <Button danger type="text" size="small" shape="circle" icon={<Trash2 className="size-3.5" />} className="!absolute !right-2 !top-2" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }} aria-label="删除输出" /> : null}
            </div>
            <button type="button" aria-label="从输出开始连接" className="absolute right-0 top-1/2 z-30 flex size-10 translate-x-1/2 -translate-y-1/2 items-center justify-center opacity-0 group-hover:opacity-100" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onStartSource(); }}>
                <span className="size-3 rounded-full border-2" style={{ background: theme.node.panel, borderColor: theme.node.muted }} />
            </button>
        </div>
    );
}
