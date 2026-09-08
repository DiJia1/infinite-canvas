"use client";

import { type ReactNode } from "react";
import { ConfigProvider } from "antd";
import { CanvasSettingsSelect } from "@/components/canvas-settings-select";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { imageAspectOptions } from "@/lib/image-generation-config";
import { normalizeImageBackground, normalizeImageOutputFormat } from "@/lib/image-output-config";
import { imageRequestOptionLabel, normalizeImageRequestOptions, schemaOptionString, type ImageRequestOptions, type ImageRequestSchema } from "@/lib/image-request-schema";
import type { AiConfig } from "@/stores/use-config-store";

const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
];

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "resolution" | "outputFormat" | "background" | "count", value: string) => void;
    onProviderOptionsChange?: (options: ImageRequestOptions) => void;
    schema?: ImageRequestSchema;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, onProviderOptionsChange, schema, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15 }: ImageSettingsPanelProps) {
    const providerOptions = normalizeImageRequestOptions(schema, config.providerOptions);
    const field = (key: string) => schema?.fields.find((item) => item.key === key);
    const fieldOptions = (key: string, fallback: readonly { value: string; label: string }[]) => field(key)?.options || fallback;
    const updateProviderOption = (key: string, value: unknown) => {
        if (!schema) return;
        const next = { ...providerOptions, [key]: value };
        if (key !== "size" && field("size")) next.size = activeSize;
        if (key === "background" && value === "transparent" && next.outputFormat === "jpeg") next.outputFormat = "png";
        if (key === "outputFormat" && value === "jpeg" && next.background === "transparent") next.background = field("background")?.options?.some((item) => item.value === "auto") ? "auto" : "opaque";
        const normalized = normalizeImageRequestOptions(schema, next);
        if (field("size")) normalized.size = next.size;
        onProviderOptionsChange?.(normalized);
        if (key === "quality" || key === "size" || key === "resolution" || key === "outputFormat" || key === "background") {
            onConfigChange(key, typeof normalized[key] === "string" ? normalized[key] : String(value));
        }
    };
    const quality = schemaOptionString(providerOptions, "quality") || config.quality || "auto";
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = schemaOptionString(config.providerOptions, "size") || config.size || "";
    const sizeOptions = field("size")?.options || [];
    const invalidSize = Boolean(field("size") && !sizeOptions.some((item) => item.value === activeSize));
    const resolution = schemaOptionString(providerOptions, "resolution") || config.resolution;
    const outputFormat = schemaOptionString(providerOptions, "outputFormat") || normalizeImageOutputFormat(config.outputFormat);
    const background = schemaOptionString(providerOptions, "background") || normalizeImageBackground(config.background);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                {!schema || field("quality") ? (
                    <div className="space-y-2.5">
                        <SettingTitle color={theme.node.muted}>质量</SettingTitle>
                        <div className="grid grid-cols-4 gap-2.5">
                            {fieldOptions("quality", qualityOptions).map((item) => (
                                <OptionPill key={item.value} selected={quality === item.value} theme={theme} onClick={() => (schema ? updateProviderOption("quality", item.value) : onConfigChange("quality", item.value))}>
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    </div>
                ) : null}
                {!schema || field("resolution") ? (
                    <div className="space-y-2.5">
                        <SettingTitle color={theme.node.muted}>尺寸</SettingTitle>
                        <CanvasSettingsSelect
                            aria-label="尺寸"
                            value={resolution || undefined}
                            options={fieldOptions("resolution", []).map((item) => ({ value: item.value, label: imageRequestOptionLabel(item) }))}
                            onChange={(value) => (schema ? updateProviderOption("resolution", value) : onConfigChange("resolution", value))}
                        />
                    </div>
                ) : null}
                {field("size") ? (
                    <div className="space-y-2.5">
                        <SettingTitle color={theme.node.muted}>宽高比</SettingTitle>
                        <CanvasSettingsSelect
                            aria-label="宽高比"
                            className="w-full"
                            value={invalidSize ? undefined : activeSize || undefined}
                            placeholder={sizeOptions.length ? "请选择比例" : "管理员尚未配置比例"}
                            options={sizeOptions}
                            onChange={(value) => updateProviderOption("size", value)}
                        />
                        {invalidSize && (
                            <p role="alert" className="text-xs">
                                {sizeOptions.length ? "请选择当前模型支持的比例" : "管理员尚未配置比例"}
                            </p>
                        )}
                    </div>
                ) : null}
                {schema && !field("size") ? (
                    <p className="text-xs" style={{ color: theme.node.muted }}>
                        请在提示词中描述画面比例。
                    </p>
                ) : null}
                {!schema || field("outputFormat") ? (
                    <div className="space-y-2.5">
                        <SettingTitle color={theme.node.muted}>输出格式</SettingTitle>
                        <CanvasSettingsSelect
                            aria-label="输出格式"
                            value={outputFormat}
                            options={fieldOptions("outputFormat", [{ value: "jpeg", label: "JPEG" }, { value: "png", label: "PNG" }]).map((item) => ({ value: item.value, label: imageRequestOptionLabel(item) }))}
                            onChange={(value) => {
                                if (schema) updateProviderOption("outputFormat", value);
                                else {
                                    onConfigChange("outputFormat", value);
                                    if (value === "jpeg" && background === "transparent") onConfigChange("background", "auto");
                                }
                            }}
                        />
                    </div>
                ) : null}
                {!schema || field("background") ? (
                    <div className="space-y-2.5">
                        <SettingTitle color={theme.node.muted}>背景</SettingTitle>
                        <CanvasSettingsSelect
                            aria-label="背景"
                            value={background}
                            options={fieldOptions("background", [{ value: "auto", label: "自动" }, { value: "opaque", label: "不透明" }, { value: "transparent", label: "透明" }]).map((item) => ({ value: item.value, label: imageRequestOptionLabel(item) }))}
                            onChange={(value) => {
                                if (schema) updateProviderOption("background", value);
                                else {
                                    if (value === "transparent" && outputFormat === "jpeg") onConfigChange("outputFormat", "png");
                                    onConfigChange("background", value);
                                }
                            }}
                        />
                    </div>
                ) : null}
                {schema?.fields
                    .filter((item) => !["quality", "size", "resolution", "outputFormat", "background"].includes(item.key))
                    .map((item) => (
                        <SchemaFieldControl key={item.key} field={item} value={providerOptions[item.key]} theme={theme} onChange={(value) => updateProviderOption(item.key, value)} />
                    ))}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                    <CanvasSettingsSelect
                        aria-label="生成张数"
                        value={String(count)}
                        options={Array.from({ length: maxCount }, (_, index) => ({ value: String(index + 1), label: `${index + 1} 张` }))}
                        onChange={(value) => onConfigChange("count", value)}
                    />
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return ({ auto: "自动", high: "高", medium: "中", low: "低" } as Record<string, string>)[value] || value;
}

export function imageSizeLabel(size: string) {
    return imageAspectOptions.find((item) => item.value === size)?.label || size;
}

export function imageResolutionLabel(resolution: string) {
    return resolution.trim();
}

export function imageOutputFormatLabel(value: string) {
    return normalizeImageOutputFormat(value).toUpperCase();
}

export function imageBackgroundLabel(value: unknown) {
    return ({ auto: "自动", opaque: "不透明", transparent: "透明" } as Record<string, string>)[normalizeImageBackground(value)] || "自动";
}

function SchemaFieldControl({ field, value, theme, onChange }: { field: import("@/lib/image-request-schema").ImageRequestField; value: unknown; theme: CanvasTheme; onChange: (value: unknown) => void }) {
    if (field.type === "boolean") {
        return (
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>{field.label}</SettingTitle>
                <div className="grid grid-cols-2 gap-2.5">
                    <OptionPill selected={value === true} theme={theme} onClick={() => onChange(true)}>
                        开启
                    </OptionPill>
                    <OptionPill selected={value === false} theme={theme} onClick={() => onChange(false)}>
                        关闭
                    </OptionPill>
                </div>
            </div>
        );
    }
    if (field.type === "select") {
        return (
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>{field.label}</SettingTitle>
                <div className="grid grid-cols-2 gap-2.5">
                    {field.options?.map((option) => (
                        <OptionPill key={option.value} selected={value === option.value} theme={theme} onClick={() => onChange(option.value)}>
                            {option.label}
                        </OptionPill>
                    ))}
                </div>
            </div>
        );
    }
    return (
        <div className="space-y-2.5">
            <SettingTitle color={theme.node.muted}>{field.label}</SettingTitle>
            <input
                type={field.type === "number" ? "number" : "text"}
                className="h-10 w-full rounded-xl border bg-transparent px-3 text-sm outline-none"
                style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                value={typeof value === "string" || typeof value === "number" ? value : ""}
                onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </div>
    );
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}
