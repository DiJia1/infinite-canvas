"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Empty, Input, Modal, Spin } from "antd";
import { ArrowLeft, Clapperboard, Clock3, Image as ImageIcon, Images, LocateFixed, Play, Save, Square, Type, Video, WandSparkles, ZoomIn, ZoomOut } from "lucide-react";
import { nanoid } from "nanoid";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { AppActions } from "@/components/layout/app-actions";
import { ScopedVideoResourceProvider } from "@/app/(user)/canvas/components/canvas-video-content";
import { CanvasNodeType, type CanvasNodeData } from "@/app/(user)/canvas/types";
import { useCanvasImageResources } from "@/app/(user)/canvas/media/use-canvas-image-resources";
import { isCanvasNodeNearViewport } from "@/app/(user)/canvas/utils/canvas-node-visibility";
import { appPath } from "@/lib/app-path";
import { canvasThemes } from "@/lib/canvas-theme";
import { isEditableTarget } from "@/lib/editable-target";
import { uploadUserImage } from "@/services/api/image";
import { ApiRequestError } from "@/services/api/request";
import { uploadVideoMedia } from "@/services/api/video-media";
import { createWorkflowRun, fetchWorkflow, fetchWorkflowRun, fetchWorkflowRuns, fetchWorkflowVideos, retryWorkflowOutput, stopWorkflowRun, updateWorkflow } from "@/services/api/workflows";
import { portalSessionQuery } from "@/services/api/session";
import { getRemoteImageAccess } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { reconcileProviderConfig, useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { reconcileVideoConfig } from "@/lib/video-config";
import { workflowConfigFromAiConfig } from "./workflow-config";
import { addWorkflowConnection, createWorkflowNode, emptyWorkflowGraph, findAvailableWorkflowNodePosition, findWorkflowConnection, removeWorkflowConnection, removeWorkflowNode, removeWorkflowOutput, setWorkflowOutputCount, workflowConnectionKey, workflowSourceType, type WorkflowConnectionIdentity } from "./workflow-graph";
import { applyWorkflowSaveResult, cacheSavedWorkflow, clearWorkflowDraft, readWorkflowDraft, remoteWorkflowEditorState, workflowDetailQueryKey, workflowEditorSnapshot, writeWorkflowDraft, type WorkflowEditorDocument } from "./workflow-editor-state";
import { WorkflowNodeCard, WorkflowOutputCard, type WorkflowPreviewInput } from "./workflow-node";
import { WorkflowMediaPreview } from "./workflow-media-preview";
import { WorkflowRunDetail } from "./workflow-run-detail";
import { clearPendingWorkflowRetryRequest, clearPendingWorkflowRunRequest, ensureWorkflowRetryRequest, ensureWorkflowRunRequest, pendingWorkflowRetryKey, readPendingWorkflowRetryRequests, readPendingWorkflowRunRequest, workflowRetryWasAccepted, writePendingWorkflowRetryRequest, writePendingWorkflowRunRequest, type PendingWorkflowRetryRequest, type PendingWorkflowRunRequest } from "./workflow-run-requests";
import { findWorkflowOutput, isRetryableImageOutput, isWorkflowRunActive, latestWorkflowRun, workflowOutputKey, workflowOutputResourceNodeId, workflowRunStatusText } from "./workflow-run-state";
import { observeWorkflowViewport } from "./workflow-viewport";
import type { WorkflowConnection, WorkflowGraph, WorkflowNode, WorkflowNodeType, WorkflowOutputSlot, WorkflowPosition } from "./types";

type Viewport = { x: number; y: number; k: number };
type Selection = { kind: "node"; nodeId: string } | { kind: "output"; nodeId: string; slotId: string } | ({ kind: "connection" } & WorkflowConnectionIdentity) | null;
type ConnectionStart = { nodeId: string; slotId: string } | null;
type DragState = { kind: "node" | "output"; nodeId: string; slotId?: string; startX: number; startY: number; position: WorkflowPosition } | null;
type SaveVariables = { revision: number; name: string; graph: WorkflowGraph; editorSnapshot: string };

function isDefinitiveWorkflowMutationError(error: unknown) {
    return error instanceof ApiRequestError && error.status >= 400 && error.status < 500;
}

export function WorkflowEditor() {
    const route = useParams<{ id: string | string[] }>();
    const workflowId = Array.isArray(route.id) ? route.id[0] : route.id;
    const router = useRouter();
    const queryClient = useQueryClient();
    const { message, modal } = App.useApp();
    const session = useQuery({ ...portalSessionQuery, refetchOnMount: "always" });
    const draftOwnerUID = session.data?.user.uid;
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const aiStatus = useConfigStore((state) => state.status);
    const globalConfig = useConfigStore((state) => state.config);
    const assets = useAssetStore((state) => state.assets);
    const refreshAssets = useAssetStore((state) => state.refreshFromServer);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const loadedRef = useRef("");
    const editorDocumentRef = useRef<WorkflowEditorDocument>({ name: "", graph: emptyWorkflowGraph() });
    const dragRef = useRef<DragState>(null);
    const panRef = useRef<{ x: number; y: number; viewport: Viewport } | null>(null);
    const requestRestoreScopeRef = useRef("");
    const retryRestoreScopeRef = useRef("");
    const [name, setName] = useState("");
    const [graph, setGraph] = useState<WorkflowGraph>(emptyWorkflowGraph);
    const [revision, setRevision] = useState(0);
    const [savedSnapshot, setSavedSnapshot] = useState("");
    const [viewport, setViewport] = useState<Viewport>({ x: 80, y: 80, k: 0.8 });
    const [selection, setSelection] = useState<Selection>(null);
    const [connectionStart, setConnectionStart] = useState<ConnectionStart>(null);
    const [mouseWorld, setMouseWorld] = useState<WorkflowPosition>({ x: 0, y: 0 });
    const [mediaTarget, setMediaTarget] = useState<{ nodeId?: string; type: "image" | "video" }>();
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [previewNodeId, setPreviewNodeId] = useState<string>();
    const [uploading, setUploading] = useState(false);
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(null);
    const [currentRunId, setCurrentRunId] = useState<string | null>();
    const [runDetailOpen, setRunDetailOpen] = useState(false);
    const [pendingRunRequest, setPendingRunRequest] = useState<PendingWorkflowRunRequest>();
    const [pendingRetryRequests, setPendingRetryRequests] = useState<Record<string, PendingWorkflowRetryRequest>>({});
    const attachCanvasElement = useCallback((element: HTMLDivElement | null) => {
        containerRef.current = element;
        setCanvasElement(element);
    }, []);

    const workflow = useQuery({ queryKey: workflowDetailQueryKey(workflowId), queryFn: () => fetchWorkflow(workflowId!), enabled: Boolean(workflowId), refetchOnMount: "always", refetchOnWindowFocus: false, refetchOnReconnect: false });
    const workflowVideos = useQuery({ queryKey: ["workflow-video-assets"], queryFn: fetchWorkflowVideos, enabled: assetPickerOpen && mediaTarget?.type === "video" });
    const workflowRuns = useQuery({
        queryKey: ["workflow-runs", "workflow", workflowId],
        queryFn: () => fetchWorkflowRuns(1, 1, workflowId),
        enabled: Boolean(workflowId && workflow.data),
        refetchInterval: (query) => query.state.data?.items.some((run) => run.workflowId === workflowId && isWorkflowRunActive(run.status)) ? 2500 : false,
    });
    const currentRun = useQuery({
        queryKey: ["workflow-run", currentRunId],
        queryFn: () => fetchWorkflowRun(currentRunId!),
        enabled: Boolean(currentRunId),
        refetchInterval: (query) => isWorkflowRunActive(query.state.data?.run.status) ? 1500 : false,
    });
    useEffect(() => {
        setCurrentRunId(undefined);
        setRunDetailOpen(false);
        setPendingRunRequest(undefined);
        setPendingRetryRequests({});
        requestRestoreScopeRef.current = "";
        retryRestoreScopeRef.current = "";
    }, [workflowId]);
    useEffect(() => {
        if (!draftOwnerUID || !workflowId || !workflow.data || revision < 1 || typeof window === "undefined") return;
        const scope = `${draftOwnerUID}:${workflowId}:${revision}`;
        if (requestRestoreScopeRef.current === scope) return;
        requestRestoreScopeRef.current = scope;
        setPendingRunRequest(readPendingWorkflowRunRequest(window.sessionStorage, draftOwnerUID, workflowId));
    }, [draftOwnerUID, revision, workflow.data, workflowId]);
    useEffect(() => {
        if (currentRunId !== undefined || !workflowRuns.data) return;
        setCurrentRunId(latestWorkflowRun(workflowRuns.data.items, workflowId)?.id || null);
    }, [currentRunId, workflowId, workflowRuns.data]);
    useEffect(() => {
        if (!draftOwnerUID || !currentRunId || typeof window === "undefined") return;
        const scope = `${draftOwnerUID}:${currentRunId}`;
        if (retryRestoreScopeRef.current === scope) return;
        retryRestoreScopeRef.current = scope;
        const restored = readPendingWorkflowRetryRequests(window.sessionStorage, draftOwnerUID, currentRunId);
        if (restored.length) setPendingRetryRequests((current) => ({ ...current, ...Object.fromEntries(restored.map((request) => [pendingWorkflowRetryKey(request), request])) }));
    }, [currentRunId, draftOwnerUID]);
    useEffect(() => {
        if (!pendingRunRequest || !workflowRuns.data) return;
        const accepted = workflowRuns.data.items.find((run) => run.requestId === pendingRunRequest.requestId && run.workflowId === pendingRunRequest.workflowId);
        if (!accepted) return;
        setCurrentRunId(accepted.id);
        if (draftOwnerUID && typeof window !== "undefined") clearPendingWorkflowRunRequest(window.sessionStorage, draftOwnerUID, pendingRunRequest.workflowId);
        setPendingRunRequest(undefined);
    }, [draftOwnerUID, pendingRunRequest, workflowRuns.data]);
    useEffect(() => {
        if (!currentRun.data) return;
        const accepted = Object.entries(pendingRetryRequests).filter(([, pending]) => pending.runId === currentRun.data!.run.id && workflowRetryWasAccepted(pending, findWorkflowOutput(currentRun.data!.outputs, pending.nodeId, pending.slotId)));
        if (!accepted.length) return;
        if (draftOwnerUID && typeof window !== "undefined") accepted.forEach(([, pending]) => clearPendingWorkflowRetryRequest(window.sessionStorage, draftOwnerUID, pending));
        setPendingRetryRequests((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !accepted.some(([acceptedKey]) => acceptedKey === key))));
    }, [currentRun.data, draftOwnerUID, pendingRetryRequests]);

    const currentSnapshot = useMemo(() => workflowEditorSnapshot({ name, graph }), [graph, name]);
    editorDocumentRef.current = { name, graph };
    const dirty = Boolean(savedSnapshot && currentSnapshot !== savedSnapshot);
    const applyRemoteWorkflow = useCallback((remote: NonNullable<typeof workflow.data>, restoreDraft = true) => {
        const remoteState = remoteWorkflowEditorState("", 0, false, remote)!;
        const draft = restoreDraft && draftOwnerUID && typeof window !== "undefined" ? readWorkflowDraft(window.sessionStorage, draftOwnerUID, remote.id) : undefined;
        const restore = draft?.revision === remote.revision && workflowEditorSnapshot(draft.document) !== remoteState.savedSnapshot;
        if (draft && !restore && draftOwnerUID) clearWorkflowDraft(window.sessionStorage, draftOwnerUID, remote.id);
        loadedRef.current = remote.id;
        setName(restore ? draft.document.name : remoteState.document.name);
        setGraph(restore ? draft.document.graph : remoteState.document.graph);
        setRevision(remoteState.revision);
        setSavedSnapshot(remoteState.savedSnapshot);
        if (restore) message.info("已恢复未保存的流程修改");
    }, [draftOwnerUID, message]);
    useEffect(() => {
        if (!draftOwnerUID || session.isFetching || !workflow.data || workflow.isFetching || !remoteWorkflowEditorState(loadedRef.current, revision, dirty, workflow.data)) return;
        applyRemoteWorkflow(workflow.data);
    }, [applyRemoteWorkflow, dirty, draftOwnerUID, revision, session.isFetching, workflow.data, workflow.isFetching]);
    useLayoutEffect(() => observeWorkflowViewport(canvasElement, setViewportSize, (update) => new ResizeObserver(update)), [canvasElement]);
    const previewImageNodeIds = useMemo(() => new Set(graph.connections.flatMap((connection) => {
        if (connection.targetNodeId !== previewNodeId) return [];
        const source = graph.nodes.find((node) => node.id === connection.sourceNodeId);
        if (!source || workflowSourceType(source, connection.sourceSlotId) !== "image") return [];
        if (connection.sourceSlotId === "output") return [source.id];
        const output = currentRun.data ? findWorkflowOutput(currentRun.data.outputs, source.id, connection.sourceSlotId) : undefined;
        return output?.mediaId && currentRun.data ? [workflowOutputResourceNodeId(currentRun.data.run.id, source.id, connection.sourceSlotId)] : [];
    })), [currentRun.data, graph.connections, graph.nodes, previewNodeId]);
    const imageTargets = useMemo(() => {
        const inputTargets = graph.nodes.flatMap((node) => {
            if (node.type !== "image_input" || !node.mediaId) return [];
            const canvasNode = { id: node.id, type: CanvasNodeType.Image, title: "", position: node.position, width: node.width || 340, height: node.height || 240, metadata: { mediaId: node.mediaId } } satisfies CanvasNodeData;
            const visible = isCanvasNodeNearViewport(canvasNode, viewport, viewportSize);
            const preview = previewImageNodeIds.has(node.id);
            const prefetch = !visible && isCanvasNodeNearViewport(canvasNode, viewport, viewportSize, 384);
            if (!visible && !prefetch && !preview) return [];
            return [{ node: canvasNode, visible, pinned: preview, prefetch, preview }];
        });
        const outputTargets = graph.nodes.flatMap((node) => (node.outputs || []).flatMap((slot) => {
            if (slot.type !== "image" || !currentRun.data) return [];
            const output = findWorkflowOutput(currentRun.data.outputs, node.id, slot.id);
            if (output?.status !== "succeeded" || !output.mediaId) return [];
            const canvasNode = { id: workflowOutputResourceNodeId(currentRun.data.run.id, node.id, slot.id), type: CanvasNodeType.Image, title: "", position: slot.position || node.position, width: slot.width || 340, height: slot.height || 240, metadata: { mediaId: output.mediaId } } satisfies CanvasNodeData;
            const visible = isCanvasNodeNearViewport(canvasNode, viewport, viewportSize);
            const preview = previewImageNodeIds.has(canvasNode.id);
            const prefetch = !visible && isCanvasNodeNearViewport(canvasNode, viewport, viewportSize, 384);
            if (!visible && !prefetch && !preview) return [];
            return [{ node: canvasNode, visible, pinned: preview, prefetch, preview }];
        }));
        return [...inputTargets, ...outputTargets];
    }, [currentRun.data, graph.nodes, previewImageNodeIds, viewport, viewportSize]);
    const resolveImageAccess = useCallback((node: CanvasNodeData) => getRemoteImageAccess(node.metadata!.mediaId!), []);
    const imageResources = useCanvasImageResources({ targets: imageTargets, scale: viewport.k, resolveAccess: resolveImageAccess });
    useEffect(() => {
        if (!dirty) return;
        const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty]);
    useEffect(() => {
        if (!draftOwnerUID || !workflowId || !savedSnapshot || typeof window === "undefined") return;
        if (dirty) writeWorkflowDraft(window.sessionStorage, draftOwnerUID, workflowId, { revision, document: { name, graph } });
        else clearWorkflowDraft(window.sessionStorage, draftOwnerUID, workflowId);
    }, [dirty, draftOwnerUID, graph, name, revision, savedSnapshot, workflowId]);
    useEffect(() => {
        if (assetPickerOpen && mediaTarget?.type === "image") void refreshAssets().catch((error) => message.error(error instanceof Error ? error.message : "素材加载失败"));
    }, [assetPickerOpen, mediaTarget?.type, message, refreshAssets]);

    const save = useMutation({
        mutationFn: (submitted: SaveVariables) => updateWorkflow(workflowId!, { revision: submitted.revision, name: submitted.name, graph: submitted.graph }),
        onSuccess: (saved, submitted) => {
            const result = applyWorkflowSaveResult(editorDocumentRef.current, submitted.editorSnapshot, saved);
            cacheSavedWorkflow(queryClient, saved);
            loadedRef.current = saved.id;
            setName(result.document.name);
            setGraph(result.document.graph);
            setRevision(result.revision);
            setSavedSnapshot(result.savedSnapshot);
            message.success("流程已保存");
        },
        onError: (error) => {
            if (error instanceof ApiRequestError && error.status === 409) {
                modal.confirm({
                    title: "流程已在其他页面更新",
                    content: "重新加载会放弃当前未保存修改。",
                    okText: "重新加载",
                    cancelText: "保留当前修改",
                    onOk: async () => {
                        if (draftOwnerUID) clearWorkflowDraft(window.sessionStorage, draftOwnerUID, workflowId!);
                        const remote = await fetchWorkflow(workflowId!);
                        cacheSavedWorkflow(queryClient, remote);
                        applyRemoteWorkflow(remote, false);
                    },
                });
            }
            else message.error(error instanceof Error ? error.message : "保存流程失败");
        },
    });
    const cacheRun = useCallback((detail: NonNullable<typeof currentRun.data>) => {
        queryClient.setQueryData(["workflow-run", detail.run.id], detail);
        setCurrentRunId(detail.run.id);
        void queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
    }, [queryClient]);
    const createRun = useMutation({
        retry: false,
        mutationFn: (request: PendingWorkflowRunRequest) => createWorkflowRun(request.workflowId, request.requestId),
        onSuccess: (detail, request) => {
            cacheRun(detail);
            if (draftOwnerUID && typeof window !== "undefined") clearPendingWorkflowRunRequest(window.sessionStorage, draftOwnerUID, request.workflowId);
            setPendingRunRequest((current) => current?.requestId === request.requestId ? undefined : current);
            message.success("流程已开始运行");
        },
        onError: (error, request) => {
            if (isDefinitiveWorkflowMutationError(error)) {
                if (draftOwnerUID && typeof window !== "undefined") clearPendingWorkflowRunRequest(window.sessionStorage, draftOwnerUID, request.workflowId);
                setPendingRunRequest((current) => current?.requestId === request.requestId ? undefined : current);
            }
            else {
                void workflowRuns.refetch();
                message.warning("运行请求结果待确认，可再次点击并使用同一请求确认");
                return;
            }
            message.error(error instanceof Error ? error.message : "启动流程失败");
        },
    });
    const stopRun = useMutation({
        mutationFn: (runId: string) => stopWorkflowRun(runId),
        onSuccess: (detail) => {
            cacheRun(detail);
            message.success("已停止领取新的生成任务");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "停止流程失败"),
    });
    const retryOutput = useMutation({
        retry: false,
        mutationFn: (request: PendingWorkflowRetryRequest) => retryWorkflowOutput(request.runId, { requestId: request.requestId, nodeId: request.nodeId, slotId: request.slotId }),
        onSuccess: (detail, request) => {
            cacheRun(detail);
            const key = pendingWorkflowRetryKey(request);
            if (draftOwnerUID && typeof window !== "undefined") clearPendingWorkflowRetryRequest(window.sessionStorage, draftOwnerUID, request);
            setPendingRetryRequests((current) => {
                if (current[key]?.requestId !== request.requestId) return current;
                const next = { ...current };
                delete next[key];
                return next;
            });
            message.success("已重新提交失败输出");
        },
        onError: (error, request) => {
            if (isDefinitiveWorkflowMutationError(error)) {
                const key = pendingWorkflowRetryKey(request);
                if (draftOwnerUID && typeof window !== "undefined") clearPendingWorkflowRetryRequest(window.sessionStorage, draftOwnerUID, request);
                setPendingRetryRequests((current) => {
                    if (current[key]?.requestId !== request.requestId) return current;
                    const next = { ...current };
                    delete next[key];
                    return next;
                });
                message.error(error instanceof Error ? error.message : "重试输出失败");
                return;
            }
            void currentRun.refetch();
            message.warning("重试请求结果待确认，可再次点击并使用同一请求确认");
        },
    });

    const startRun = () => {
        const request = ensureWorkflowRunRequest(pendingRunRequest, workflowId!, revision, nanoid);
        if (draftOwnerUID && typeof window !== "undefined") writePendingWorkflowRunRequest(window.sessionStorage, draftOwnerUID, request);
        setPendingRunRequest(request);
        createRun.mutate(request);
    };
    const startOutputRetry = (nodeId: string, slotId: string) => {
        if (!currentRun.data) return;
        const output = findWorkflowOutput(currentRun.data.outputs, nodeId, slotId);
        if (!output) return;
        const key = pendingWorkflowRetryKey({ runId: currentRun.data.run.id, nodeId, slotId });
        const request = ensureWorkflowRetryRequest(pendingRetryRequests[key], { runId: currentRun.data.run.id, nodeId, slotId, attempt: output.attempt }, nanoid);
        if (draftOwnerUID && typeof window !== "undefined") writePendingWorkflowRetryRequest(window.sessionStorage, draftOwnerUID, request);
        setPendingRetryRequests((current) => ({ ...current, [key]: request }));
        retryOutput.mutate(request);
    };

    const updateNode = useCallback((nodeId: string, update: (node: WorkflowNode) => WorkflowNode) => setGraph((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === nodeId ? update(node) : node) })), []);
    const screenToWorld = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        return { x: ((clientX - (rect?.left || 0)) - viewport.x) / viewport.k, y: ((clientY - (rect?.top || 0)) - viewport.y) / viewport.k };
    }, [viewport]);
    const centerPosition = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return { x: ((rect?.width || 1000) / 2 - viewport.x) / viewport.k - 180, y: ((rect?.height || 700) / 2 - viewport.y) / viewport.k - 120 };
    }, [viewport]);

    const addNode = useCallback((type: WorkflowNodeType, mediaId?: string) => {
        const node = createWorkflowNode(type, findAvailableWorkflowNodePosition(graph, type, centerPosition()));
        if (mediaId) node.mediaId = mediaId;
        if (type === "image_generation" && aiStatus) {
            const config = reconcileProviderConfig(globalConfig, aiStatus);
            node.config = workflowConfigFromAiConfig(type, config);
        }
        if (type === "video_generation" && aiStatus) {
            const config = reconcileVideoConfig(globalConfig, aiStatus);
            node.config = workflowConfigFromAiConfig(type, config);
        }
        setGraph((current) => ({ ...current, nodes: [...current.nodes, node] }));
        setSelection({ kind: "node", nodeId: node.id });
    }, [aiStatus, centerPosition, globalConfig, graph]);

    const chooseMedia = (nodeId: string | undefined, type: "image" | "video") => {
        setMediaTarget({ nodeId, type });
        setAssetPickerOpen(true);
    };
    const uploadImage = async (file: File) => {
        setUploading(true);
        try {
            const uploaded = await uploadUserImage(file, "canvas");
            if (mediaTarget?.nodeId) updateNode(mediaTarget.nodeId, (node) => ({ ...node, mediaId: uploaded.mediaId }));
            else addNode("image_input", uploaded.mediaId);
            setAssetPickerOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "图片上传失败");
        } finally {
            setUploading(false);
            setMediaTarget(undefined);
        }
    };
    const uploadVideo = async (file: File) => {
        setUploading(true);
        try {
            const uploaded = await uploadVideoMedia(file);
            if (mediaTarget?.nodeId) updateNode(mediaTarget.nodeId, (node) => ({ ...node, mediaId: uploaded.mediaId }));
            else addNode("video_input", uploaded.mediaId);
            setAssetPickerOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["workflow-video-assets"] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "视频上传失败");
        } finally {
            setUploading(false);
            setMediaTarget(undefined);
        }
    };
    const selectAsset = (mediaId: string) => {
        if (mediaTarget?.nodeId) updateNode(mediaTarget.nodeId, (node) => ({ ...node, mediaId }));
        else addNode(mediaTarget?.type === "video" ? "video_input" : "image_input", mediaId);
        setAssetPickerOpen(false);
        setMediaTarget(undefined);
    };

    const changeOutputCount = (nodeId: string, count: number) => {
        try {
            setGraph(setWorkflowOutputCount(graph, nodeId, count));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "无法调整输出数量");
        }
    };

    const previewInputs = useCallback((targetId: string): WorkflowPreviewInput[] => graph.connections.filter((connection) => connection.targetNodeId === targetId).sort((left, right) => left.order - right.order).flatMap((connection) => {
        const source = graph.nodes.find((node) => node.id === connection.sourceNodeId);
        if (!source) return [];
        const type = workflowSourceType(source, connection.sourceSlotId);
        if (!type) return [];
        const execution = connection.sourceSlotId === "output" || !currentRun.data ? undefined : findWorkflowOutput(currentRun.data.outputs, source.id, connection.sourceSlotId);
        const resourceNodeId = execution && currentRun.data ? workflowOutputResourceNodeId(currentRun.data.run.id, source.id, connection.sourceSlotId) : source.id;
        const mediaId = source.mediaId || execution?.mediaId;
        const resource = imageResources.resources.get(resourceNodeId);
        return [{ key: connection.targetPortId, sourceNodeId: resourceNodeId, type, ...(type === "text" ? { text: source.text } : mediaId ? { mediaId } : {}), ...(type === "image" && resource ? { imageUrl: resource.url, imageStorageKey: resource.storageKey } : {}), ...(type === "image" && imageResources.errors.get(resourceNodeId) ? { imageError: imageResources.errors.get(resourceNodeId) } : {}) }];
    }), [currentRun.data, graph, imageResources.errors, imageResources.resources]);
    const activePreviewInputs = previewNodeId ? previewInputs(previewNodeId) : [];

    const connectTo = (targetNodeId: string) => {
        if (!connectionStart) return;
        try {
            const source = graph.nodes.find((node) => node.id === connectionStart.nodeId);
            const target = graph.nodes.find((node) => node.id === targetNodeId);
            const type = source ? workflowSourceType(source, connectionStart.slotId) : undefined;
            if (type && target?.config?.providerId) {
                const model = target.type === "image_generation" ? aiStatus?.imageModels?.find((item) => item.id === target.config?.providerId) : aiStatus?.videoModels?.find((item) => item.id === target.config?.providerId);
                const currentCount = graph.connections.filter((item) => item.targetNodeId === target.id).map((item) => {
                    const input = graph.nodes.find((node) => node.id === item.sourceNodeId);
                    return input ? workflowSourceType(input, item.sourceSlotId) : undefined;
                }).filter((item) => item === type).length;
                const limit = type === "image" ? model?.imageRequestSchema?.maxReferenceImages ?? model?.videoRequestSchema?.maxReferenceImages : type === "video" ? model?.videoRequestSchema?.maxReferenceVideos : undefined;
                if (typeof limit === "number" && currentCount >= limit) throw new Error(`当前模型最多支持 ${limit} 个${type === "image" ? "图片" : "视频"}输入`);
            }
            setGraph(addWorkflowConnection(graph, { sourceNodeId: connectionStart.nodeId, sourceSlotId: connectionStart.slotId, targetNodeId }));
            setConnectionStart(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "连线失败");
        }
    };

    const startNodeDrag = (event: ReactPointerEvent, node: WorkflowNode) => {
        if (event.button !== 0 || (event.target as Element).closest("button,input,textarea,.ant-select")) return;
        event.stopPropagation();
        dragRef.current = { kind: "node", nodeId: node.id, startX: event.clientX, startY: event.clientY, position: node.position };
        setSelection({ kind: "node", nodeId: node.id });
    };
    const startOutputDrag = (event: ReactPointerEvent, parent: WorkflowNode, slot: WorkflowOutputSlot) => {
        if (event.button !== 0 || (event.target as Element).closest("button")) return;
        event.stopPropagation();
        dragRef.current = { kind: "output", nodeId: parent.id, slotId: slot.id, startX: event.clientX, startY: event.clientY, position: slot.position || parent.position };
        setSelection({ kind: "output", nodeId: parent.id, slotId: slot.id });
    };
    useEffect(() => {
        const move = (event: PointerEvent) => {
            if (dragRef.current) {
                const drag = dragRef.current;
                const position = { x: drag.position.x + (event.clientX - drag.startX) / viewport.k, y: drag.position.y + (event.clientY - drag.startY) / viewport.k };
                if (drag.kind === "node") updateNode(drag.nodeId, (node) => ({ ...node, position }));
                else updateNode(drag.nodeId, (node) => ({ ...node, outputs: node.outputs?.map((slot) => slot.id === drag.slotId ? { ...slot, position } : slot) }));
            } else if (panRef.current) {
                setViewport({ ...panRef.current.viewport, x: panRef.current.viewport.x + event.clientX - panRef.current.x, y: panRef.current.viewport.y + event.clientY - panRef.current.y });
            }
        };
        const stop = () => { dragRef.current = null; panRef.current = null; };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("blur", stop);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); window.removeEventListener("blur", stop); };
    }, [updateNode, viewport.k]);

    const deleteSelection = useCallback(() => {
        if (!selection) return;
        try {
            if (selection.kind === "node") setGraph((current) => removeWorkflowNode(current, selection.nodeId));
            if (selection.kind === "output") setGraph((current) => removeWorkflowOutput(current, selection.nodeId, selection.slotId));
            if (selection.kind === "connection") {
                const connection = findWorkflowConnection(graph, selection);
                if (connection) setGraph((current) => removeWorkflowConnection(current, connection));
            }
            setSelection(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        }
    }, [graph.connections, message, selection]);
    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            if ((event.key === "Delete" || event.key === "Backspace") && !isEditableTarget(event.target)) deleteSelection();
            if (event.key === "Escape") setConnectionStart(null);
        };
        window.addEventListener("keydown", keydown);
        return () => window.removeEventListener("keydown", keydown);
    }, [deleteSelection]);

    const navigateAway = (href: string) => {
        if (!dirty) { router.push(href); return; }
        modal.confirm({
            title: "放弃未保存修改？",
            content: "离开后，本次修改将不会保留。",
            okText: "放弃修改",
            okButtonProps: { danger: true },
            cancelText: "继续编辑",
            onOk: () => {
                if (draftOwnerUID && workflowId) clearWorkflowDraft(window.sessionStorage, draftOwnerUID, workflowId);
                router.push(href);
            },
        });
    };
    const leave = () => navigateAway(appPath("/workflows"));
    const latestRunSummary = latestWorkflowRun(workflowRuns.data?.items, workflowId);
    const runActive = isWorkflowRunActive(currentRun.data?.run.status || latestRunSummary?.status);

    if (session.isPending || workflow.isPending || (!loadedRef.current && (session.isFetching || workflow.isFetching))) return <div className="flex h-full items-center justify-center"><Spin /></div>;
    if (session.isError || workflow.isError || !workflow.data) return <div className="flex h-full flex-col items-center justify-center gap-4 text-sm text-stone-500"><span>{workflow.error instanceof Error ? workflow.error.message : session.error instanceof Error ? session.error.message : "流程加载失败"}</span><Button onClick={() => void Promise.all([session.refetch(), workflow.refetch()])}>重新加载</Button></div>;

    return (
        <ScopedVideoResourceProvider scope={`workflow:${workflowId}:run:${currentRun.data?.run.id || "definition"}`} nodeIds={[
            ...graph.nodes.filter((node) => node.type === "video_input").map((node) => node.id),
            ...graph.nodes.flatMap((node) => (node.outputs || []).flatMap((slot) => slot.type === "video" && currentRun.data && findWorkflowOutput(currentRun.data.outputs, node.id, slot.id)?.mediaId ? [workflowOutputResourceNodeId(currentRun.data.run.id, node.id, slot.id)] : [])),
            ...activePreviewInputs.filter((input) => input.type === "video" && input.mediaId).map((input) => `preview-${input.sourceNodeId}-${input.key}`),
        ]}>
        <main className="relative flex h-full min-h-0 flex-col overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <header className="relative z-50 flex h-14 shrink-0 items-center gap-3 border-b px-3" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} onClick={leave} aria-label="返回流程库" />
                <Input value={name} maxLength={128} aria-label="流程名称" className="!w-52" onChange={(event) => setName(event.target.value)} />
                <span className="text-xs opacity-50">{dirty ? "未保存" : `已保存 · v${revision}`}</span>
                <div className="ml-auto flex items-center gap-2">
                    <Button type="text" icon={<Clock3 className="size-4" />} onClick={() => navigateAway(appPath("/workflow-runs"))}>运行记录</Button>
                    {currentRun.data ? <Button type="text" loading={currentRun.isFetching && !runActive} onClick={() => setRunDetailOpen(true)}>{workflowRunStatusText(currentRun.data.run.status)} · v{currentRun.data.run.revision}</Button> : null}
                    {runActive && currentRun.data && !currentRun.data.run.stopRequested ? <Button danger icon={<Square className="size-4" />} loading={stopRun.isPending} onClick={() => stopRun.mutate(currentRun.data.run.id)}>停止</Button> : null}
                    <Button icon={<Play className="size-4" />} disabled={runActive || save.isPending || (!pendingRunRequest && dirty)} loading={createRun.isPending} title={pendingRunRequest ? "使用同一请求 ID 确认上次运行" : dirty ? "请先保存当前修改" : runActive ? "当前运行结束后可再次运行" : undefined} onClick={startRun}>{pendingRunRequest ? "确认上次运行" : "运行"}</Button>
                    <Button type="primary" icon={<Save className="size-4" />} disabled={!dirty || !name.trim() || Boolean(pendingRunRequest)} loading={save.isPending} title={pendingRunRequest ? "请先确认上次运行请求" : undefined} onClick={() => save.mutate({ revision, name: name.trim(), graph, editorSnapshot: currentSnapshot })}>保存</Button>
                    <AppActions variant="canvas" onOpenSettings={() => navigateAway(appPath("/admin/settings"))} />
                </div>
            </header>
            <div className="relative min-h-0 flex-1">
                <div className="absolute left-3 top-3 z-40 flex flex-wrap items-center gap-1.5 rounded-xl border p-1.5 shadow-sm backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                    <ToolButton icon={<Type />} label="文本" onClick={() => addNode("text_input")} />
                    <ToolButton icon={<ImageIcon />} label="图片" onClick={() => { setMediaTarget({ type: "image" }); setAssetPickerOpen(true); }} />
                    <ToolButton icon={<Video />} label="视频" onClick={() => chooseMedia(undefined, "video")} />
                    <span className="mx-0.5 h-5 w-px" style={{ background: theme.toolbar.border }} />
                    <ToolButton icon={<WandSparkles />} label="生图" onClick={() => addNode("image_generation")} />
                    <ToolButton icon={<Clapperboard />} label="视频生成" onClick={() => addNode("video_generation")} />
                    <ToolButton icon={<Images />} label="我的素材" onClick={() => { setMediaTarget({ type: "image" }); setAssetPickerOpen(true); }} />
                </div>
                <div className="absolute bottom-3 right-3 z-40 flex items-center gap-1 rounded-xl border p-1 shadow-sm" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                    <Button type="text" size="small" shape="circle" icon={<ZoomOut className="size-4" />} onClick={() => setViewport((current) => ({ ...current, k: Math.max(0.2, current.k / 1.15) }))} aria-label="缩小" />
                    <span className="w-11 text-center text-xs tabular-nums">{Math.round(viewport.k * 100)}%</span>
                    <Button type="text" size="small" shape="circle" icon={<ZoomIn className="size-4" />} onClick={() => setViewport((current) => ({ ...current, k: Math.min(2, current.k * 1.15) }))} aria-label="放大" />
                    <Button type="text" size="small" shape="circle" icon={<LocateFixed className="size-4" />} onClick={() => setViewport({ x: 80, y: 80, k: 0.8 })} aria-label="复位视图" />
                </div>
                <div
                    ref={attachCanvasElement}
                    className="relative h-full w-full cursor-grab select-none overflow-hidden"
                    style={{ backgroundImage: `linear-gradient(${theme.canvas.line} 1px, transparent 1px),linear-gradient(90deg,${theme.canvas.line} 1px,transparent 1px)`, backgroundSize: `${48 * viewport.k}px ${48 * viewport.k}px`, backgroundPosition: `${viewport.x % (48 * viewport.k)}px ${viewport.y % (48 * viewport.k)}px` }}
                    onPointerDown={(event) => {
                        if (event.button !== 0 || (event.target as Element).closest("[data-workflow-object],button,input,textarea")) return;
                        panRef.current = { x: event.clientX, y: event.clientY, viewport };
                        setSelection(null);
                        setConnectionStart(null);
                    }}
                    onPointerMove={(event) => {
                        if (connectionStart) setMouseWorld(screenToWorld(event.clientX, event.clientY));
                    }}
                    onWheel={(event) => {
                        event.preventDefault();
                        const rect = containerRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        const mouseX = event.clientX - rect.left;
                        const mouseY = event.clientY - rect.top;
                        const worldX = (mouseX - viewport.x) / viewport.k;
                        const worldY = (mouseY - viewport.y) / viewport.k;
                        const k = Math.max(0.2, Math.min(2, viewport.k * Math.exp(-event.deltaY * 0.001)));
                        setViewport({ x: mouseX - worldX * k, y: mouseY - worldY * k, k });
                    }}
                >
                    <div className="absolute origin-top-left" style={{ transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.k})` }}>
                        <WorkflowConnections graph={graph} selection={selection} connectionStart={connectionStart} mouseWorld={mouseWorld} onSelect={(identity) => setSelection({ kind: "connection", ...identity })} />
                        {graph.nodes.map((node) => (
                            <WorkflowNodeCard
                                key={node.id}
                                node={node}
                                selected={selection?.kind === "node" && selection.nodeId === node.id}
                                connecting={Boolean(connectionStart)}
                                videoVisible={isCanvasNodeNearViewport({ id: node.id, type: CanvasNodeType.Video, title: "", position: node.position, width: node.width || 420, height: node.height || 236 } satisfies CanvasNodeData, viewport, viewportSize)}
                                inputs={previewInputs(node.id)}
                                imageUrl={imageResources.resources.get(node.id)?.url}
                                imageStorageKey={imageResources.resources.get(node.id)?.storageKey}
                                imageError={imageResources.errors.get(node.id)}
                                onRetryImage={() => imageResources.retry(node.id)}
                                onImageLoaded={(storageKey) => imageResources.acknowledgeRendered(node.id, storageKey)}
                                onSelect={() => setSelection({ kind: "node", nodeId: node.id })}
                                onDragStart={startNodeDrag}
                                onRemove={() => setGraph((current) => removeWorkflowNode(current, node.id))}
                                onChooseMedia={() => chooseMedia(node.id, node.type === "video_input" ? "video" : "image")}
                                onTextChange={(text) => updateNode(node.id, (current) => ({ ...current, text }))}
                                onConfigChange={(config) => updateNode(node.id, (current) => ({ ...current, config }))}
                                onOutputCountChange={(count) => changeOutputCount(node.id, count)}
                                onPreview={() => setPreviewNodeId(node.id)}
                                onConnectTarget={() => connectTo(node.id)}
                                onStartSource={() => setConnectionStart({ nodeId: node.id, slotId: "output" })}
                            />
                        ))}
                        {graph.nodes.flatMap((node) => (node.outputs || []).map((slot) => (
                            <WorkflowOutputCard
                                key={workflowOutputKey(node.id, slot.id)}
                                parent={node}
                                slot={slot}
                                execution={currentRun.data ? findWorkflowOutput(currentRun.data.outputs, node.id, slot.id) : undefined}
                                resourceNodeId={currentRun.data ? workflowOutputResourceNodeId(currentRun.data.run.id, node.id, slot.id) : undefined}
                                videoVisible={isCanvasNodeNearViewport({ id: workflowOutputKey(node.id, slot.id), type: CanvasNodeType.Video, title: "", position: slot.position || node.position, width: slot.width || 420, height: slot.height || 236 } satisfies CanvasNodeData, viewport, viewportSize)}
                                imageUrl={currentRun.data ? imageResources.resources.get(workflowOutputResourceNodeId(currentRun.data.run.id, node.id, slot.id))?.url : undefined}
                                imageStorageKey={currentRun.data ? imageResources.resources.get(workflowOutputResourceNodeId(currentRun.data.run.id, node.id, slot.id))?.storageKey : undefined}
                                imageError={currentRun.data ? imageResources.errors.get(workflowOutputResourceNodeId(currentRun.data.run.id, node.id, slot.id)) : undefined}
                                retrying={retryOutput.isPending && retryOutput.variables?.nodeId === node.id && retryOutput.variables.slotId === slot.id}
                                confirmingRetry={Boolean(currentRun.data && pendingRetryRequests[pendingWorkflowRetryKey({ runId: currentRun.data.run.id, nodeId: node.id, slotId: slot.id })])}
                                onReloadMedia={currentRun.data ? () => imageResources.retry(workflowOutputResourceNodeId(currentRun.data.run.id, node.id, slot.id)) : undefined}
                                onRetryOutput={currentRun.data && isRetryableImageOutput(slot, findWorkflowOutput(currentRun.data.outputs, node.id, slot.id), currentRun.data.run) ? () => startOutputRetry(node.id, slot.id) : undefined}
                                onImageLoaded={(storageKey) => currentRun.data && imageResources.acknowledgeRendered(workflowOutputResourceNodeId(currentRun.data.run.id, node.id, slot.id), storageKey)}
                                selected={selection?.kind === "output" && selection.nodeId === node.id && selection.slotId === slot.id}
                                onSelect={() => setSelection({ kind: "output", nodeId: node.id, slotId: slot.id })}
                                onDragStart={startOutputDrag}
                                onRemove={() => {
                                    try { setGraph(removeWorkflowOutput(graph, node.id, slot.id)); }
                                    catch (error) { message.error(error instanceof Error ? error.message : "无法删除输出"); }
                                }}
                                onStartSource={() => setConnectionStart({ nodeId: node.id, slotId: slot.id })}
                            />
                        )))}
                    </div>
                </div>
            </div>
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); event.target.value = ""; }} />
            <input ref={videoInputRef} type="file" accept="video/mp4" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadVideo(file); event.target.value = ""; }} />
            <Modal title={mediaTarget?.type === "video" ? "选择视频" : "选择图片"} open={assetPickerOpen} footer={<Button icon={mediaTarget?.type === "video" ? <Video className="size-4" /> : <ImageIcon className="size-4" />} loading={uploading} onClick={() => mediaTarget?.type === "video" ? videoInputRef.current?.click() : imageInputRef.current?.click()}>上传{mediaTarget?.type === "video" ? "视频" : "图片"}</Button>} onCancel={() => { setAssetPickerOpen(false); setMediaTarget(undefined); }} width={760} destroyOnHidden>
                {mediaTarget?.type === "video" ? workflowVideos.isPending ? <div className="flex min-h-48 items-center justify-center"><Spin /></div> : workflowVideos.isError ? <Empty description={workflowVideos.error instanceof Error ? workflowVideos.error.message : "视频素材加载失败"}><Button onClick={() => void workflowVideos.refetch()}>重新加载</Button></Empty> : workflowVideos.data.items.length ? (
                    <div className="grid max-h-[55vh] grid-cols-3 gap-3 overflow-auto sm:grid-cols-4">
                        {workflowVideos.data.items.map((video) => <button key={video.id} type="button" className="overflow-hidden rounded-xl border border-stone-200 text-left dark:border-stone-700" onClick={() => selectAsset(video.id)}><span className="flex aspect-[4/3] items-center justify-center bg-black text-white"><Video className="size-7" /></span><span className="block truncate px-2 pt-1.5 text-xs">{video.title || video.filename || "视频素材"}</span><span className="block px-2 pb-1.5 text-[11px] text-stone-500">{video.duration > 0 ? `${video.duration.toFixed(1)} 秒` : "视频"}</span></button>)}
                    </div>
                ) : <Empty description="暂无可用视频素材" /> : (
                    <div className="grid max-h-[55vh] grid-cols-3 gap-3 overflow-auto sm:grid-cols-4">
                        {assets.flatMap((asset) => asset.kind === "image" && typeof asset.metadata?.mediaId === "string" ? [<button key={asset.id} type="button" className="overflow-hidden rounded-xl border border-stone-200 text-left dark:border-stone-700" onClick={() => selectAsset(asset.metadata!.mediaId as string)}><img src={asset.coverUrl} alt="" className="aspect-[4/3] w-full object-cover" /><span className="block truncate px-2 py-1.5 text-xs">{asset.title}</span></button>] : [])}
                    </div>
                )}
            </Modal>
            <Modal title="输入预览" open={Boolean(previewNodeId)} footer={null} width={760} onCancel={() => setPreviewNodeId(undefined)} destroyOnHidden>
                {activePreviewInputs.length ? (
                    <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-auto sm:grid-cols-3">
                        {activePreviewInputs.map((input) => (
                            <div key={input.key} className="aspect-square overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
                                {input.type === "text" ? <div className="h-full overflow-auto whitespace-pre-wrap p-3 text-xs leading-5">{input.text || "空文本"}</div> : input.mediaId ? <WorkflowMediaPreview nodeId={`preview-${input.sourceNodeId}-${input.key}`} type={input.type} mediaId={input.mediaId} imageUrl={input.imageUrl} imageStorageKey={input.imageStorageKey} imageError={input.imageError} /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-stone-400">{input.type === "image" ? <ImageIcon className="size-6" /> : <Video className="size-6" />}运行后显示</div>}
                            </div>
                        ))}
                    </div>
                ) : <div className="py-12 text-center text-sm text-stone-500">暂无输入</div>}
            </Modal>
            <Drawer title="本次运行" open={runDetailOpen} width="min(920px, 94vw)" destroyOnHidden onClose={() => setRunDetailOpen(false)}>
                {currentRun.isError ? <Empty description={currentRun.error instanceof Error ? currentRun.error.message : "运行详情加载失败"}><Button onClick={() => void currentRun.refetch()}>重新加载</Button></Empty> : (
                    <WorkflowRunDetail
                        detail={currentRun.data}
                        stopping={stopRun.isPending}
                        retryingKey={retryOutput.isPending && retryOutput.variables ? workflowOutputKey(retryOutput.variables.nodeId, retryOutput.variables.slotId) : undefined}
                        confirmingRetryKeys={new Set(Object.values(pendingRetryRequests).filter((request) => request.runId === currentRun.data?.run.id).map((request) => workflowOutputKey(request.nodeId, request.slotId)))}
                        onStop={currentRun.data ? () => stopRun.mutate(currentRun.data.run.id) : undefined}
                        onRetry={currentRun.data ? startOutputRetry : undefined}
                    />
                )}
            </Drawer>
        </main>
        </ScopedVideoResourceProvider>
    );
}

function ToolButton({ icon, label, onClick }: { icon: React.ReactElement; label: string; onClick: () => void }) {
    return <Button type="text" size="small" icon={<span className="[&_svg]:size-4">{icon}</span>} onClick={onClick}>{label}</Button>;
}

function WorkflowConnections({ graph, selection, connectionStart, mouseWorld, onSelect }: { graph: WorkflowGraph; selection: Selection; connectionStart: ConnectionStart; mouseWorld: WorkflowPosition; onSelect: (identity: WorkflowConnectionIdentity) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const path = (from: WorkflowPosition, to: WorkflowPosition) => {
        const distance = Math.max(80, Math.abs(to.x - from.x) * 0.5);
        return `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}`;
    };
    const sourcePoint = (nodeId: string, slotId: string) => {
        const node = graph.nodes.find((item) => item.id === nodeId);
        if (!node) return undefined;
        if (slotId === "output") return { x: node.position.x + (node.width || 340), y: node.position.y + (node.height || 240) / 2 };
        const slot = node.outputs?.find((item) => item.id === slotId);
        if (!slot) return undefined;
        const position = slot.position || node.position;
        return { x: position.x + (slot.width || 340), y: position.y + (slot.height || 240) / 2 };
    };
    return (
        <svg className="pointer-events-none absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible">
            {graph.nodes.flatMap((node) => (node.outputs || []).map((slot) => {
                const position = slot.position || node.position;
                const from = { x: node.position.x + (node.width || 360), y: node.position.y + (node.height || 260) / 2 };
                const to = { x: position.x, y: position.y + (slot.height || 240) / 2 };
                return <path key={`output:${workflowOutputKey(node.id, slot.id)}`} d={path(from, to)} fill="none" stroke={theme.node.muted} strokeWidth="2" strokeOpacity="0.55" strokeDasharray="6 5" pointerEvents="none" />;
            }))}
            {graph.connections.map((connection) => {
                const from = sourcePoint(connection.sourceNodeId, connection.sourceSlotId);
                const target = graph.nodes.find((node) => node.id === connection.targetNodeId);
                if (!from || !target) return null;
                const to = { x: target.position.x, y: target.position.y + (target.height || 260) / 2 };
                const active = selection?.kind === "connection" && selection.targetNodeId === connection.targetNodeId && selection.targetPortId === connection.targetPortId;
                const curve = path(from, to);
                return (
                    <g key={workflowConnectionKey(connection)}>
                        <path data-workflow-object d={curve} fill="none" stroke="transparent" strokeWidth="16" style={{ cursor: "pointer", pointerEvents: "stroke" }} onClick={(event) => { event.stopPropagation(); onSelect(connection); }} />
                        <path d={curve} fill="none" stroke={active ? theme.node.activeStroke : theme.node.muted} strokeWidth={active ? 4 : 2} pointerEvents="none" />
                    </g>
                );
            })}
            {connectionStart ? (() => { const from = sourcePoint(connectionStart.nodeId, connectionStart.slotId); return from ? <path d={path(from, mouseWorld)} fill="none" stroke={theme.node.activeStroke} strokeWidth="2" strokeDasharray="6 5" pointerEvents="none" /> : null; })() : null}
        </svg>
    );
}
