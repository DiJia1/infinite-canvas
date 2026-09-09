"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Input, Pagination, Skeleton } from "antd";
import { Check, Clock3, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { appPath } from "@/lib/app-path";
import { copyWorkflow, createWorkflow, deleteWorkflow, fetchWorkflow, fetchWorkflows, updateWorkflow } from "@/services/api/workflows";
import type { WorkflowListItem } from "./types";

export function WorkflowLibrary() {
    const { message, modal } = App.useApp();
    const router = useRouter();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const pageSize = 12;
    const workflows = useQuery({ queryKey: ["workflows", page, pageSize], queryFn: () => fetchWorkflows(page, pageSize) });
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["workflows"] });
    const createMutation = useMutation({
        mutationFn: () => createWorkflow({ name: `自动化流程 ${(workflows.data?.total || 0) + 1}` }),
        onSuccess: (workflow) => {
            void refresh();
            router.push(appPath(`/workflows/${workflow.id}`));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "新建流程失败"),
    });
    const copyMutation = useMutation({
        mutationFn: (workflow: WorkflowListItem) => copyWorkflow(workflow.id, `${workflow.name} 副本`),
        onSuccess: () => {
            void refresh();
            message.success("已复制流程");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "复制流程失败"),
    });
    const deleteMutation = useMutation({
        mutationFn: (workflow: WorkflowListItem) => deleteWorkflow(workflow.id, workflow.revision),
        onSuccess: () => {
            void refresh();
            message.success("已删除流程");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "删除流程失败"),
    });
    const renameMutation = useMutation({
        mutationFn: async ({ workflow, name }: { workflow: WorkflowListItem; name: string }) => {
            const current = await fetchWorkflow(workflow.id);
            return updateWorkflow(workflow.id, { revision: current.revision, name, graph: current.graph });
        },
        onSuccess: () => {
            void refresh();
            message.success("已保存名称");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "重命名失败"),
    });

    const confirmDelete = (workflow: WorkflowListItem) => {
        modal.confirm({
            title: "删除流程",
            content: `确定删除“${workflow.name}”吗？历史运行记录将继续保留。`,
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => deleteMutation.mutateAsync(workflow),
        });
    };

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">流程库</p>
                        <h1 className="mt-3 text-3xl font-semibold">自动化流程</h1>
                        <p className="mt-2 text-sm text-stone-500">保存并重复使用图片与视频生成流程。</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button icon={<Clock3 className="size-4" />} onClick={() => router.push(appPath("/workflow-runs"))}>运行记录</Button>
                        <Button type="primary" icon={<Plus className="size-4" />} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
                            新建流程
                        </Button>
                    </div>
                </header>

                {workflows.isPending ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {Array.from({ length: 3 }, (_, index) => <Skeleton.Node key={index} active className="!h-44 !w-full !rounded-2xl" />)}
                    </div>
                ) : workflows.isError ? (
                    <Empty description={workflows.error instanceof Error ? workflows.error.message : "流程列表加载失败"}>
                        <Button onClick={() => void workflows.refetch()}>重新加载</Button>
                    </Empty>
                ) : workflows.data.items.length ? (
                    <>
                        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                            {workflows.data.items.map((workflow) => (
                                <WorkflowCard
                                    key={workflow.id}
                                    workflow={workflow}
                                    busy={copyMutation.isPending || deleteMutation.isPending || renameMutation.isPending}
                                    onOpen={() => router.push(appPath(`/workflows/${workflow.id}`))}
                                    onCopy={() => copyMutation.mutate(workflow)}
                                    onDelete={() => confirmDelete(workflow)}
                                    onRename={(name) => renameMutation.mutate({ workflow, name })}
                                />
                            ))}
                        </div>
                        {workflows.data.total > pageSize ? <Pagination current={page} pageSize={pageSize} total={workflows.data.total} showSizeChanger={false} className="self-center" onChange={setPage} /> : null}
                    </>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-stone-200 text-center dark:border-stone-800">
                        <h2 className="text-xl font-medium">还没有自动化流程</h2>
                        <p className="mt-3 text-sm text-stone-500">新建流程后，可以连接输入、生成配置和固定输出。</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
                            新建流程
                        </Button>
                    </section>
                )}
            </div>
        </main>
    );
}

function WorkflowCard({ workflow, busy, onOpen, onCopy, onDelete, onRename }: { workflow: WorkflowListItem; busy: boolean; onOpen: () => void; onCopy: () => void; onDelete: () => void; onRename: (name: string) => void }) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(workflow.name);
    const saveName = () => {
        const value = name.trim();
        if (!value || value === workflow.name) {
            setName(workflow.name);
            setEditing(false);
            return;
        }
        onRename(value);
        setEditing(false);
    };
    return (
        <article
            role="button"
            tabIndex={0}
            aria-label={`打开流程 ${workflow.name}`}
            className="group flex min-h-44 cursor-pointer flex-col justify-between rounded-2xl bg-[#f1eee8] p-5 transition hover:bg-[#ebe6dc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 dark:bg-white/5 dark:hover:bg-white/10"
            onClick={() => !editing && onOpen()}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget || editing || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                onOpen();
            }}
        >
            <div className="flex items-start gap-3">
                {editing ? (
                    <Input value={name} maxLength={128} autoFocus onClick={(event) => event.stopPropagation()} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveName()} />
                ) : (
                    <div className="min-w-0">
                        <h2 className="truncate text-xl font-semibold">{workflow.name}</h2>
                        <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-400">{workflow.nodeCount} 个节点 · {workflow.connectionCount} 条连线</p>
                    </div>
                )}
            </div>
            <div className="mt-8 flex items-end justify-between gap-3">
                <p className="text-xs text-stone-500">已保存 · v{workflow.revision} · 更新于 {new Date(workflow.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                        <>
                            <Button type="text" size="small" shape="circle" disabled={busy} icon={<Check className="size-4" />} onClick={saveName} aria-label="保存名称" />
                            <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={() => { setName(workflow.name); setEditing(false); }} aria-label="取消重命名" />
                        </>
                    ) : (
                        <>
                            <Button type="text" size="small" shape="circle" disabled={busy} icon={<Copy className="size-4" />} onClick={onCopy} aria-label="复制流程" />
                            <Button type="text" size="small" shape="circle" disabled={busy} icon={<Pencil className="size-4" />} onClick={() => { setName(workflow.name); setEditing(true); }} aria-label="重命名流程" />
                            <Button type="text" size="small" shape="circle" disabled={busy} icon={<Trash2 className="size-4" />} onClick={onDelete} aria-label="删除流程" />
                        </>
                    )}
                </div>
            </div>
        </article>
    );
}
