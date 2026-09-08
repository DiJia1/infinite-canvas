import assert from "node:assert/strict";
import test from "node:test";
import { Children, isValidElement, type ReactNode } from "react";
import { ImageSettingsPanel } from "./image-settings-panel";
import { defaultAiConfig } from "@/lib/ai-config";
import { canvasThemes } from "@/lib/canvas-theme";
import { type ImageRequestSchema } from "@/lib/image-request-schema";

const component = ImageSettingsPanel;
function elements(node: ReactNode): Array<{ type: unknown; props: Record<string, any> }> {
    return Children.toArray(node).flatMap((child) => (isValidElement(child) ? [child as any, ...elements((child.props as { children?: ReactNode }).children)] : []));
}
const schema: ImageRequestSchema = {
    version: "v1",
    maxReferenceImages: 0,
    supportsMask: false,
    fields: [
        {
            key: "size",
            type: "select",
            required: true,
            label: "比例",
            default: "7:3",
            options: [
                { value: "7:3", label: "电影画幅" },
                { value: "auto", label: "自动" },
            ],
        },
    ],
};

test("ratio dropdown renders upstream options directly and preserves explicit selection", () => {
    const changes: unknown[] = [];
    const tree = component({ config: { ...defaultAiConfig, size: "1:1", providerOptions: { size: "1:1" } }, schema, theme: canvasThemes.light, onProviderOptionsChange: (value: unknown) => changes.push(value), onConfigChange: () => {} });
    const nodes = elements(tree);
    const select = nodes.find((node) => node.props["aria-label"] === "宽高比")!;
    assert.deepEqual(select.props.options, schema.fields[0].options);
    assert.equal(select.props.value, undefined);
    assert.ok(nodes.some((node) => node.props.role === "alert"));
    assert.deepEqual(changes, []);
    select.props.onChange("7:3");
    assert.deepEqual(changes, [{ size: "7:3" }]);
});

test("providers without a ratio field do not show a fallback ratio selector", () => {
    const tree = component({ config: defaultAiConfig, schema: { ...schema, fields: [] }, theme: canvasThemes.light, onConfigChange: () => {} });
    assert.equal(
        elements(tree).some((node) => node.props["aria-label"] === "宽高比"),
        false,
    );
});

test("empty upstream ratios show an explicit missing configuration state", () => {
    const tree = component({ config: defaultAiConfig, schema: { ...schema, fields: [{ ...schema.fields[0], options: [] }] }, theme: canvasThemes.light, onConfigChange: () => {} });
    const nodes = elements(tree);
    assert.deepEqual(nodes.find((node) => node.props["aria-label"] === "宽高比")?.props.options, []);
    assert.equal(nodes.find((node) => node.props.role === "alert")?.props.children, "管理员尚未配置比例");
});

test("format and background selects preserve fallback JPEG transparency coupling", () => {
    const changes: unknown[] = [];
    const tree = elements(component({ config: { ...defaultAiConfig, outputFormat: "jpeg", background: "transparent" }, theme: canvasThemes.dark, onConfigChange: (...args) => changes.push(args) }));
    tree.find((item) => item.props["aria-label"] === "输出格式")!.props.onChange("jpeg");
    assert.deepEqual(changes, [["outputFormat", "jpeg"], ["background", "auto"]]);
    changes.length = 0;
    tree.find((item) => item.props["aria-label"] === "背景")!.props.onChange("transparent");
    assert.deepEqual(changes, [["outputFormat", "png"], ["background", "transparent"]]);
});

test("count select exposes every supported integer and forwards selection once", () => {
    const changes: unknown[] = [];
    const tree = elements(component({ config: { ...defaultAiConfig, count: "2" }, maxCount: 7, theme: canvasThemes.dark, onConfigChange: (...args) => changes.push(args) }));
    const count = tree.find((item) => item.props["aria-label"] === "生成张数")!;
    assert.equal(count.props.value, "2");
    assert.deepEqual(count.props.options.map((option: any) => option.value), ["1", "2", "3", "4", "5", "6", "7"]);
    count.props.onChange("4");
    assert.deepEqual(changes, [["count", "4"]]);
});
