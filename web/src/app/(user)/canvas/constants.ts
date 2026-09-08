import { CanvasNodeType } from "./types";
import type { CanvasNodeData, CanvasNodeMetadata } from "./types";

type CanvasNodeSpec = {
    width: number;
    height: number;
    title: string;
    metadata?: CanvasNodeMetadata;
};

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: { width: 340, height: 240, title: "New Generation" },
    [CanvasNodeType.Text]: { width: 340, height: 240, title: "Note" },
    [CanvasNodeType.Config]: { width: 360, height: 260, title: "生成配置" },
    [CanvasNodeType.Video]: { width: 420, height: 236, title: "Video" },
} satisfies Record<CanvasNodeType, { width: number; height: number; title: string }>;

export const NODE_SPECS = {
    [CanvasNodeType.Image]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Image],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Text]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Text],
        metadata: { content: "", status: "idle", fontSize: 14 },
    },
    [CanvasNodeType.Config]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Config],
        metadata: { content: "", status: "idle", generationMode: "image" },
    },
    [CanvasNodeType.Video]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Video],
        metadata: { content: "", status: "idle" },
    },
} satisfies Record<CanvasNodeType, CanvasNodeSpec>;

export function getNodeSpec(type: CanvasNodeType) {
    return NODE_SPECS[type];
}

export function normalizeVideoConfigNodeSize(node: CanvasNodeData): CanvasNodeData {
    if (node.type !== CanvasNodeType.Config || node.metadata?.generationMode !== "video") return node;
    const width = Math.max(340, node.width);
    const height = Math.max(260, node.height);
    return width === node.width && height === node.height ? node : { ...node, width, height };
}
