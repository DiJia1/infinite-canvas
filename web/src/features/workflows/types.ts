export type WorkflowMediaType = "image" | "video" | "text";

export type WorkflowNodeType = "image_input" | "video_input" | "text_input" | "image_generation" | "video_generation";

export type WorkflowPosition = { x: number; y: number };

export type WorkflowInputPort = {
    id: string;
    type: WorkflowMediaType;
};

export type WorkflowGenerationConfig = {
    providerId?: string;
    size?: string;
    resolution?: string;
    quality?: string;
    outputFormat?: string;
    background?: string;
    seconds?: number;
    generateAudio?: boolean;
    options?: Record<string, unknown>;
};

export type WorkflowOutputSlot = {
    id: string;
    type: "image" | "video";
    position?: WorkflowPosition;
    width?: number;
    height?: number;
};

export type WorkflowNode = {
    id: string;
    type: WorkflowNodeType;
    position: WorkflowPosition;
    width?: number;
    height?: number;
    text?: string;
    mediaId?: string;
    inputPorts?: WorkflowInputPort[];
    config?: WorkflowGenerationConfig;
    outputs?: WorkflowOutputSlot[];
};

export type WorkflowConnection = {
    sourceNodeId: string;
    sourceSlotId: string;
    targetNodeId: string;
    targetPortId: string;
    order: number;
};

export type WorkflowGraph = {
    version: 1;
    nodes: WorkflowNode[];
    connections: WorkflowConnection[];
};

export type WorkflowRecord = {
    id: string;
    name: string;
    graph: WorkflowGraph;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type WorkflowListItem = Omit<WorkflowRecord, "graph"> & {
    nodeCount: number;
    connectionCount: number;
};

export type WorkflowList = {
    items: WorkflowListItem[];
    total: number;
    page: number;
    pageSize: number;
};
