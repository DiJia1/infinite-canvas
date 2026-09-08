"use client";

import { Card, Empty, Table, Tabs } from "antd";
import { formatCNYAmount } from "@/lib/money";
import type { VideoStatistics, VideoStatisticsModel, VideoStatisticsTotals, VideoStatisticsUser } from "@/services/api/admin-statistics";

const usageColumns = [
    { title: "成功调用", dataIndex: "successfulCalls", align: "right" as const },
    { title: "成功视频", dataIndex: "videoCount", align: "right" as const },
    { title: "生成秒数", dataIndex: "seconds", align: "right" as const },
    { title: "费用（CNY）", dataIndex: "amount", align: "right" as const, render: (value: string) => formatCNYAmount(value) },
    {
        title: "上游成本（独立口径）",
        render: (_: unknown, item: VideoStatisticsTotals) =>
            Object.entries(item.upstreamCosts || {})
                .sort()
                .map(([currency, amount]) => `${currency} ${amount}`)
                .join(" · ") || "—",
    },
];

function ModelTable({ models }: { models: VideoStatisticsModel[] }) {
    return (
        <Table<VideoStatisticsModel>
            size="small"
            rowKey={(item) => `${item.providerId}-${item.providerName}`}
            pagination={false}
            dataSource={models}
            columns={[{ title: "模型", render: (_, item) => item.providerName || item.providerId }, ...usageColumns]}
            expandable={{ expandedRowRender: (item) => <Table size="small" rowKey="resolution" pagination={false} dataSource={item.resolutions} columns={[{ title: "分辨率", dataIndex: "resolution" }, ...usageColumns]} /> }}
        />
    );
}

export function VideoStatisticsReport({ data }: { data?: VideoStatistics }) {
    if (!data || !data.successfulCalls) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所选时间范围暂无成功视频任务" />;
    return (
        <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-4">
                {[
                    ["费用", formatCNYAmount(data.amount)],
                    ["成功调用", `${data.successfulCalls} 次`],
                    ["成功视频", `${data.videoCount} 条`],
                    ["生成秒数", `${data.seconds} 秒`],
                ].map(([label, value]) => (
                    <Card key={label}>
                        <p className="text-sm text-stone-500">{label}</p>
                        <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
                    </Card>
                ))}
            </div>
            <p className="text-xs text-stone-500">按上海时区完成日期统计成功任务；费用使用创建时快照。生成秒数为每次成功任务请求时长之和。上游成本按币种独立汇总。</p>
            <Tabs
                items={[
                    {
                        key: "users",
                        label: "按用户消耗",
                        children: (
                            <Table<VideoStatisticsUser>
                                rowKey="userUid"
                                pagination={false}
                                dataSource={data.users}
                                columns={[{ title: "用户", render: (_, item) => item.displayName || item.userUid }, ...usageColumns]}
                                expandable={{ expandedRowRender: (item) => <ModelTable models={item.models} /> }}
                            />
                        ),
                    },
                    { key: "models", label: "按模型消耗", children: <ModelTable models={data.models} /> },
                ]}
            />
        </div>
    );
}
