"use client";

import { App, Button } from "antd";
import { Eye, Minus, Plus } from "lucide-react";

import { CanvasSettingsSelect } from "@/components/canvas-settings-select";
import { CanvasImageSettingsPopover } from "@/app/(user)/canvas/components/canvas-image-settings-popover";
import { CanvasVideoSettingsPopover } from "@/app/(user)/canvas/components/canvas-video-settings-popover";
import { defaultConfig, reconcileProviderConfig, useConfigStore } from "@/stores/use-config-store";
import { reconcileVideoConfig } from "@/lib/video-config";
import { aiConfigForWorkflowNode, workflowConfigFromAiConfig, workflowModelInputError } from "./workflow-config";
import type { WorkflowGenerationConfig, WorkflowMediaType, WorkflowNode } from "./types";

type PreviewInput = { key: string; sourceNodeId: string; type: WorkflowMediaType; text?: string; mediaId?: string; imageUrl?: string; imageStorageKey?: string; imageError?: string };

export function WorkflowConfigPanel({ node, inputs, onConfigChange, onOutputCountChange, onPreview }: { node: WorkflowNode; inputs: PreviewInput[]; onConfigChange: (config: WorkflowGenerationConfig) => void; onOutputCountChange: (count: number) => void; onPreview: () => void }) {
    const { message } = App.useApp();
    const aiStatus = useConfigStore((state) => state.status);
    const config = aiConfigForWorkflowNode(node, defaultConfig);
    const isImage = node.type === "image_generation";
    const models = isImage ? aiStatus?.imageModels : aiStatus?.videoModels;
    const selected = models?.find((model) => model.id === node.config?.providerId);
    const inputCounts = inputs.reduce<Record<WorkflowMediaType, number>>((counts, input) => ({ ...counts, [input.type]: counts[input.type] + 1 }), { image: 0, video: 0, text: 0 });
    const outputCount = node.outputs?.length || 1;
    const modelInputError = workflowModelInputError(node.type as "image_generation" | "video_generation", inputCounts, selected);
    const updateAiConfig = (next: typeof config) => onConfigChange(workflowConfigFromAiConfig(node.type as "image_generation" | "video_generation", next));
    const selectModel = (providerId: string) => {
        if (!aiStatus) return;
        const model = models?.find((item) => item.id === providerId);
        const error = workflowModelInputError(node.type as "image_generation" | "video_generation", inputCounts, model);
        if (error) {
            message.error(error);
            return;
        }
        if (isImage) updateAiConfig(reconcileProviderConfig({ ...config, imageProviderId: providerId }, aiStatus));
        else updateAiConfig(reconcileVideoConfig({ ...config, videoProviderId: providerId }, aiStatus, true));
    };

    return (
        <div className="flex h-full w-full cursor-move flex-col gap-4 overflow-hidden px-3 py-4 text-sm">
            <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">生成配置</span>
                <Button type="text" size="small" icon={<Eye className="size-3.5" />} onClick={onPreview} onPointerDown={(event) => event.stopPropagation()}>预览</Button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] opacity-65">
                <span>文本 {inputCounts.text}</span><span>·</span><span>图片 {inputCounts.image}</span>{!isImage ? <><span>·</span><span>视频 {inputCounts.video}</span></> : null}
            </div>
            <CanvasSettingsSelect className="!w-full" size="small" value={selected?.id || node.config?.providerId} placeholder="选择模型" options={models?.map((model) => ({ value: model.id, label: model.name }))} onChange={selectModel} />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                {isImage ? (
                    <CanvasImageSettingsPopover
                        config={config}
                        maxCount={9}
                        placement="bottomLeft"
                        buttonClassName="!h-8 !w-full !justify-start !rounded-md !px-2"
                        onConfigChange={(key, value) => key === "count" ? onOutputCountChange(Number(value) || 1) : updateAiConfig({ ...config, [key]: value })}
                        onProviderOptionsChange={(providerOptions) => updateAiConfig({ ...config, providerOptions })}
                    />
                ) : (
                    <CanvasVideoSettingsPopover config={config} placement="bottomLeft" buttonClassName="!h-8 !w-full !justify-start !rounded-md !px-2" onConfigChange={(key, value) => updateAiConfig({ ...config, [key]: value })} />
                )}
                <div className="flex items-center gap-0.5" onPointerDown={(event) => event.stopPropagation()}>
                    <Button type="text" size="small" shape="circle" disabled={outputCount <= 1} icon={<Minus className="size-3.5" />} onClick={() => onOutputCountChange(outputCount - 1)} aria-label="减少输出" />
                    <span className="w-5 text-center text-xs tabular-nums">{outputCount}</span>
                    <Button type="text" size="small" shape="circle" disabled={outputCount >= 9} icon={<Plus className="size-3.5" />} onClick={() => onOutputCountChange(outputCount + 1)} aria-label="增加输出" />
                </div>
            </div>
            {!models?.length ? <p className="text-xs text-amber-500">管理员尚未配置可用模型</p> : node.config?.providerId && !selected ? <p className="text-xs text-amber-500">原模型当前不可用，请重新选择</p> : null}
            {modelInputError ? <p className="text-xs text-red-500">{modelInputError}</p> : null}
        </div>
    );
}
