"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import { useCanvasInteractions } from "@/app/(user)/canvas/hooks/use-canvas-interactions";
import type { CanvasNodeData, CanvasConnection, ContextMenuState, Position, ViewportTransform } from "@/app/(user)/canvas/types";
import { addWorkflowConnection, createWorkflowNode } from "./workflow-graph";
import { applyWorkflowVisualConnections, applyWorkflowVisualNodes, copyWorkflowSelection, deleteWorkflowVisualSelection, normalizeWorkflowCanvasConnection, pasteWorkflowSelection, toWorkflowCanvasConnections, toWorkflowCanvasNodes, workflowConnectionInput, workflowVisualNodeId, workflowVisualOutputId, type WorkflowConnectionValidator } from "./workflow-canvas-adapter";
import type { WorkflowGraph, WorkflowNode, WorkflowNodeType } from "./types";

type Options = {
    graph: WorkflowGraph;
    setGraph: Dispatch<SetStateAction<WorkflowGraph>>;
    viewport: ViewportTransform;
    screenToCanvas: (clientX: number, clientY: number) => Position;
    pause: () => void;
    resume: () => void;
    onWarning: (message: string) => void;
    readOnly?: boolean;
    validateConnection?: WorkflowConnectionValidator;
    makeNode?: (type: WorkflowNodeType, position: Position) => WorkflowNode;
};

export function useWorkflowInteractions(options: Options) {
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const graphRef = useRef(options.graph);
    graphRef.current = options.graph;
    const nodes = toWorkflowCanvasNodes(options.graph);
    const connections = toWorkflowCanvasConnections(options.graph);
    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const viewportRef = useRef(options.viewport);
    nodesRef.current = nodes;
    connectionsRef.current = connections;
    viewportRef.current = options.viewport;
    const [selectedNodeIds, setSelectedState] = useState<Set<string>>(new Set());
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    selectedNodeIdsRef.current = selectedNodeIds;
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const clipboardRef = useRef<WorkflowGraph | null>(null);
    const pasteCountRef = useRef(0);
    const setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>> = (next) => {
        const value = typeof next === "function" ? next(selectedNodeIdsRef.current) : next;
        selectedNodeIdsRef.current = value;
        setSelectedState(value);
    };
    const updateGraph = (next: WorkflowGraph) => {
        if (optionsRef.current.readOnly || next === graphRef.current) return;
        graphRef.current = next;
        nodesRef.current = toWorkflowCanvasNodes(next);
        connectionsRef.current = toWorkflowCanvasConnections(next);
        optionsRef.current.setGraph(next);
    };
    const warn = (error: unknown) => optionsRef.current.onWarning(error instanceof Error ? error.message : "无法修改流程");
    const setNodes: Dispatch<SetStateAction<CanvasNodeData[]>> = (next) => updateGraph(applyWorkflowVisualNodes(graphRef.current, typeof next === "function" ? next(nodesRef.current) : next));
    const setConnections: Dispatch<SetStateAction<CanvasConnection[]>> = (next) => {
        if (optionsRef.current.readOnly) return;
        try { updateGraph(applyWorkflowVisualConnections(graphRef.current, typeof next === "function" ? next(connectionsRef.current) : next, optionsRef.current.validateConnection)); }
        catch (error) { warn(error); }
    };
    const interactions = useCanvasInteractions({
        nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef,
        setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId,
        setContextMenu, setHoveredNodeId, setToolbarNodeId, setDialogNodeId,
        pause: options.pause, resume: options.resume, screenToCanvas: options.screenToCanvas,
        createConnectionId: nanoid,
        normalizeConnection: (first, second, _nodes, handle) => optionsRef.current.readOnly ? null : normalizeWorkflowCanvasConnection(graphRef.current, first, second, handle, optionsRef.current.validateConnection),
        onWarning: options.onWarning,
    });
    useEffect(() => {
        const cancel = () => interactions.resetInteractionState();
        window.addEventListener("blur", cancel);
        window.addEventListener("pointercancel", cancel);
        return () => { window.removeEventListener("blur", cancel); window.removeEventListener("pointercancel", cancel); };
    }, [interactions.resetInteractionState]);
    const deleteSelection = () => {
        if (optionsRef.current.readOnly) return;
        try {
            updateGraph(deleteWorkflowVisualSelection(graphRef.current, selectedNodeIdsRef.current, selectedConnectionId));
            setSelectedNodeIds(new Set()); setSelectedConnectionId(null);
        } catch (error) { warn(error); }
    };
    const copySelection = () => {
        const clipboard = copyWorkflowSelection(graphRef.current, selectedNodeIdsRef.current);
        if (!clipboard.nodes.length) {
            clipboardRef.current = null;
            pasteCountRef.current = 0;
            if (selectedNodeIdsRef.current.size) optionsRef.current.onWarning("请复制所属配置，或将生成结果添加为输入");
            return false;
        }
        clipboardRef.current = clipboard; pasteCountRef.current = 0;
        return true;
    };
    const pasteSelection = () => {
        if (optionsRef.current.readOnly || !clipboardRef.current) return false;
        const offset = 48 * ++pasteCountRef.current;
        const pasted = pasteWorkflowSelection(graphRef.current, clipboardRef.current, { x: offset, y: offset });
        updateGraph(pasted.graph); setSelectedNodeIds(pasted.selectedNodeIds); setSelectedConnectionId(null);
        return true;
    };
    const createConnectedNode = (type: WorkflowNodeType) => {
        const pending = interactions.pendingConnectionCreate;
        if (!pending || optionsRef.current.readOnly) return;
        const node = (optionsRef.current.makeNode || createWorkflowNode)(type, pending.position);
        const graph = { ...graphRef.current, nodes: [...graphRef.current.nodes, node] };
        const visualId = workflowVisualNodeId(node.id);
        const connection = normalizeWorkflowCanvasConnection(graph, pending.connection.nodeId, visualId, pending.connection.handleType, optionsRef.current.validateConnection);
        const input = connection && workflowConnectionInput(connection.fromNodeId, connection.toNodeId);
        if (!input) { optionsRef.current.onWarning("该节点类型无法连接到当前端口"); return; }
        try {
            updateGraph(addWorkflowConnection(graph, input));
            setSelectedNodeIds(new Set([visualId])); setSelectedConnectionId(null);
            interactions.cancelPendingConnectionCreate();
        } catch (error) { warn(error); }
    };
    type PointerEvent = Parameters<typeof interactions.handleNodeMouseDown>[0];
    const onNodePointerDown = (event: PointerEvent, visualId: string) => {
        if ((event.button ?? 0) !== 0) return;
        if (optionsRef.current.readOnly) { event.stopPropagation?.(); setSelectedNodeIds(new Set([visualId])); return; }
        interactions.handleNodeMouseDown(event, visualId);
    };
    const onSourcePointerDown = (event: PointerEvent, nodeId: string, slotId = "output") => {
        if (optionsRef.current.readOnly || (event.button ?? 0) !== 0) return;
        const node = graphRef.current.nodes.find((item) => item.id === nodeId);
        const id = node?.type.endsWith("_input") ? workflowVisualNodeId(nodeId) : workflowVisualOutputId(nodeId, slotId);
        interactions.handleConnectStart(event, id, "source");
    };
    const onTargetPointerDown = (event: PointerEvent, nodeId: string) => {
        if (!optionsRef.current.readOnly && (event.button ?? 0) === 0) interactions.handleConnectStart(event, workflowVisualNodeId(nodeId), "target");
    };
    return { nodes, connections, nodesRef, selectedNodeIds, setSelectedNodeIds, selectedConnectionId, setSelectedConnectionId, contextMenu, setContextMenu, hoveredNodeId, setHoveredNodeId, toolbarNodeId, setToolbarNodeId, dialogNodeId, setDialogNodeId, interactions, deleteSelection, copySelection, pasteSelection, createConnectedNode, onNodePointerDown, onSourcePointerDown, onTargetPointerDown, setVisualNodes: setNodes };
}
