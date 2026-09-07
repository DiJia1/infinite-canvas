"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { App, Button, Card, Drawer, Empty, Form, Input, Select, Space, Switch, Table, Tag } from "antd";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";

import { fetchAIProviderTypes, fetchAdminSettings, saveAdminSettings, type AdminAIProvider, type AdminAIProviderType, type AdminSettings } from "@/services/api/admin";
import { isCNYAmountInput } from "@/lib/money";
import { formatImagePrices, isImageResolutionInput } from "@/lib/image-pricing";
import { useAdminStore } from "@/stores/use-admin-store";

const emptySettings: AdminSettings = { ai: { providers: [], imageProviderId: "", videoProviderId: "" } };

type ProviderFormValues = Omit<AdminAIProvider, "config"> & { config: string; fields?: Record<string, string> };

export default function AdminSettingsPage() {
    const token = useAdminStore((state) => state.token);
    const { message } = App.useApp();
    const [settings, setSettings] = useState<AdminSettings>(emptySettings);
    const [types, setTypes] = useState<AdminAIProviderType[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [form] = Form.useForm<ProviderFormValues>();
    const selectedType = Form.useWatch("type", form);
    const configFields = types.find((item) => item.id === selectedType)?.configFields || [];

    useEffect(() => {
        if (!token) return;
        void Promise.all([fetchAdminSettings(token), fetchAIProviderTypes(token)])
            .then(([nextSettings, nextTypes]) => {
                setSettings(nextSettings);
                setTypes(nextTypes);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "读取 AI 配置失败"))
            .finally(() => setLoading(false));
    }, [message, token]);

    const providers = settings.ai.providers;
    const selectOptions = providers.filter((item) => item.enabled).map((item) => ({ value: item.id, label: item.name }));
    const openEditor = (provider?: AdminAIProvider) => {
        setEditingId(provider?.id || null);
        form.setFieldsValue(
            provider
                ? {
                      ...provider,
                      imagePrices: provider.imagePrices || [],
                      config: JSON.stringify(provider.config, null, 2),
                      fields: Object.fromEntries(Object.entries(provider.config).map(([key, value]) => [key, String(value ?? "")])),
                  }
                : { id: nanoid(), name: "", type: types[0]?.id || "", enabled: true, imagePrices: [], config: "{}", fields: {} },
        );
        setDrawerOpen(true);
    };
    const saveProvider = async () => {
        const values = await form.validateFields();
        let config: Record<string, unknown> = Object.fromEntries(configFields.map((field) => [field.key, values.fields?.[field.key] || ""]));
        if (configFields.length === 0) {
            try {
                config = JSON.parse(values.config) as Record<string, unknown>;
            } catch {
                message.error("供应商参数必须是有效 JSON");
                return;
            }
        }
        const imagePrices = (values.imagePrices || []).map((item) => ({ resolution: item.resolution.trim(), amount: item.amount.trim() }));
        const resolutionKeys = new Set<string>();
        for (const item of imagePrices) {
            const key = item.resolution.toLocaleLowerCase();
            if (!isImageResolutionInput(item.resolution) || resolutionKeys.has(key)) {
                message.error("请填写不重复且不含控制字符的上游尺寸参数（最多 64 个字符）");
                return;
            }
            resolutionKeys.add(key);
        }
        const provider: AdminAIProvider = {
            ...values,
            name: values.name.trim(),
            imagePrices,
            config,
        };
        setSettings((current) => ({ ...current, ai: { ...current.ai, providers: editingId ? current.ai.providers.map((item) => (item.id === editingId ? provider : item)) : [...current.ai.providers, provider] } }));
        setDrawerOpen(false);
    };
    const removeProvider = (id: string) => {
        setSettings((current) => ({
            ...current,
            ai: {
                ...current.ai,
                providers: current.ai.providers.filter((item) => item.id !== id),
                imageProviderId: current.ai.imageProviderId === id ? "" : current.ai.imageProviderId,
                videoProviderId: current.ai.videoProviderId === id ? "" : current.ai.videoProviderId,
            },
        }));
    };
    const save = async () => {
        if (!token) return;
        setSaving(true);
        try {
            setSettings(await saveAdminSettings(token, settings));
            message.success("AI 配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-5">
            <Card
                title="AI 供应商"
                loading={loading}
                extra={
                    <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
                        保存配置
                    </Button>
                }
            >
                <div className="mb-5 grid gap-4 md:grid-cols-2">
                    <ProviderSelect
                        label="生图供应商"
                        value={settings.ai.imageProviderId}
                        options={selectOptions.filter((item) => supports(types, providers, item.value, "image_generate"))}
                        onChange={(imageProviderId) => setSettings((current) => ({ ...current, ai: { ...current.ai, imageProviderId } }))}
                    />
                    <ProviderSelect
                        label="生视频供应商"
                        value={settings.ai.videoProviderId}
                        options={selectOptions.filter((item) => supports(types, providers, item.value, "video_generate"))}
                        onChange={(videoProviderId) => setSettings((current) => ({ ...current, ai: { ...current.ai, videoProviderId } }))}
                    />
                </div>
                {types.length === 0 ? (
                    <Empty description="暂无已注册供应商。请先在后端 ai/providers 中实现并注册供应商类型。" />
                ) : (
                    <Table
                        rowKey="id"
                        pagination={false}
                        dataSource={providers}
                        columns={[
                            { title: "名称", dataIndex: "name" },
                            { title: "类型", dataIndex: "type", render: (value) => types.find((item) => item.id === value)?.name || value },
                            { title: "能力", dataIndex: "type", render: (value) => (types.find((item) => item.id === value)?.capabilities || []).map((item) => <Tag key={item}>{capabilityName(item)}</Tag>) },
                            { title: "图片价格", render: (_, provider) => (supportsImagePricing(types, provider.type) ? formatImagePrices(provider.imagePrices || []) : "—") },
                            { title: "状态", dataIndex: "enabled", render: (enabled) => <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "停用"}</Tag> },
                            {
                                title: "操作",
                                render: (_, provider) => (
                                    <Space>
                                        <Button type="link" icon={<EditOutlined />} onClick={() => openEditor(provider)}>
                                            编辑
                                        </Button>
                                        <Button danger type="link" icon={<DeleteOutlined />} onClick={() => removeProvider(provider.id)}>
                                            删除
                                        </Button>
                                    </Space>
                                ),
                            },
                        ]}
                    />
                )}
                {types.length > 0 ? (
                    <Button className="mt-4" icon={<PlusOutlined />} onClick={() => openEditor()}>
                        添加供应商
                    </Button>
                ) : null}
            </Card>
            <Drawer
                title={editingId ? "编辑供应商" : "添加供应商"}
                width={520}
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                extra={
                    <Button type="primary" onClick={() => void saveProvider()}>
                        确认
                    </Button>
                }
            >
                <Form form={form} layout="vertical">
                    <Form.Item name="id" hidden>
                        <Input />
                    </Form.Item>
                    <Form.Item label="供应商名称" name="name" rules={[{ required: true, message: "请输入供应商名称" }]}>
                        <Input placeholder="例如：豆包生产环境" />
                    </Form.Item>
                    <Form.Item label="供应商类型" name="type" rules={[{ required: true, message: "请选择供应商类型" }]}>
                        <Select options={types.map((item) => ({ value: item.id, label: item.name }))} onChange={() => form.setFieldValue("imagePrices", [])} />
                    </Form.Item>
                    <Form.Item label="启用" name="enabled" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    {supportsImagePricing(types, selectedType) ? (
                        <Form.List name="imagePrices">
                            {(fields, { add, remove }) => (
                                <Form.Item label="图片分辨率与单价（元）" required extra="已添加的分辨率会在画布中开放；删除即停用该分辨率。">
                                    <Space direction="vertical" className="w-full" size="middle">
                                        {fields.map((field) => (
                                            <Space key={field.key} className="flex w-full" align="baseline">
                                                <Form.Item
                                                    name={[field.name, "resolution"]}
                                                    rules={[
                                                        { required: true, message: "请输入上游尺寸参数" },
                                                        { validator: (_, value: string) => (isImageResolutionInput(value || "") ? Promise.resolve() : Promise.reject(new Error("请输入不含控制字符的上游尺寸参数，最多 64 个字符"))) },
                                                    ]}
                                                    className="mb-0 flex-1"
                                                >
                                                    <Input placeholder="例如：2K 或 2048x1152" />
                                                </Form.Item>
                                                <Form.Item
                                                    name={[field.name, "amount"]}
                                                    rules={[
                                                        { required: true, message: "请输入单价" },
                                                        { validator: (_, value: string) => (isCNYAmountInput(value || "") ? Promise.resolve() : Promise.reject(new Error("请输入 0 至 99999999.9999，最多四位小数"))) },
                                                    ]}
                                                    className="mb-0 flex-1"
                                                >
                                                    <Input inputMode="decimal" placeholder="例如：0.1234" />
                                                </Form.Item>
                                                <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label="停用该分辨率" />
                                            </Space>
                                        ))}
                                        <Button type="dashed" onClick={() => add({ resolution: "", amount: "" })}>
                                            添加分辨率
                                        </Button>
                                    </Space>
                                </Form.Item>
                            )}
                        </Form.List>
                    ) : null}
                    {configFields.length > 0 ? (
                        configFields.map((field) => (
                            <Form.Item key={field.key} label={field.label} name={["fields", field.key]} rules={field.required ? [{ required: true, message: `请输入${field.label}` }] : undefined}>
                                {field.type === "password" ? <Input.Password placeholder={field.placeholder} autoComplete="off" /> : <Input placeholder={field.placeholder} autoComplete="off" />}
                            </Form.Item>
                        ))
                    ) : (
                        <Form.Item label="供应商参数（JSON）" name="config" rules={[{ required: true, message: "请输入供应商参数" }]}>
                            <Input.TextArea rows={12} spellCheck={false} placeholder={'{\n  "apiKey": "..."\n}'} />
                        </Form.Item>
                    )}
                </Form>
            </Drawer>
        </div>
    );
}

function ProviderSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
    return (
        <label className="space-y-2 text-sm">
            <span>{label}</span>
            <Select allowClear className="w-full" value={value || undefined} options={options} placeholder="未配置" onChange={(next) => onChange(next || "")} />
        </label>
    );
}

function supports(types: AdminAIProviderType[], providers: AdminAIProvider[], providerId: string, capability: AdminAIProviderType["capabilities"][number]) {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider || !types.find((item) => item.id === provider.type)?.capabilities.includes(capability)) return false;
    return !supportsImagePricing(types, provider.type) || (provider.imagePrices || []).length > 0;
}

function supportsImagePricing(types: AdminAIProviderType[], type: string) {
    const capabilities = types.find((item) => item.id === type)?.capabilities || [];
    return capabilities.includes("image_generate") || capabilities.includes("image_edit");
}

function capabilityName(value: AdminAIProviderType["capabilities"][number]) {
    return ({ image_generate: "文生图", image_edit: "图像编辑", video_generate: "生视频" } as Record<string, string>)[value];
}
