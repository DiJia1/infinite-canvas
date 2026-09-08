import assert from "node:assert/strict";
import test from "node:test";
import { CanvasSettingsSelect, canvasSettingsPanelPosition, canvasSettingsPopupContainer } from "./canvas-settings-select";

test("popup mounts inside its non-scrolling owning panel, or body for canvas nodes", () => {
    const root = {} as HTMLElement;
    const body = {} as HTMLElement;
    const trigger = { closest: () => root, ownerDocument: { body } } as unknown as HTMLElement;
    assert.equal(canvasSettingsPopupContainer(trigger), root);
    trigger.closest = () => null;
    assert.equal(canvasSettingsPopupContainer(trigger), body);
});

test("select forwards a choice once and stops canvas pointer and wheel handling", () => {
    const changes: string[] = [];
    const root = CanvasSettingsSelect({ value: "invalid-old-value", options: [{ value: "5:4" }], onChange: (value) => changes.push(value) });
    const element = root.props.children;
    assert.equal(element.props.value, "invalid-old-value");
    assert.deepEqual(changes, []);
    element.props.onChange("5:4");
    assert.deepEqual(changes, ["5:4"]);
    const menu = element.props.popupRender("options");
    for (const handler of [root.props.onPointerDown, element.props.onMouseDown, menu.props.onPointerDown, menu.props.onMouseDown, menu.props.onClick, menu.props.onWheel]) {
        let stopped = 0;
        handler({ stopPropagation: () => stopped++ });
        assert.equal(stopped, 1);
    }
});

test("panel flips at viewport edges and bounds scrolling content", () => {
    const rect = { left: 200, right: 300, top: 20, bottom: 50, width: 100 };
    const nearTop = canvasSettingsPanelPosition(rect, { width: 800, height: 600 }, "topLeft");
    assert.equal("top" in nearTop ? nearTop.top : undefined, 58);
    assert.equal(nearTop.maxHeight, 530);
    const nearBottom = canvasSettingsPanelPosition({ ...rect, top: 550, bottom: 580 }, { width: 800, height: 600 }, "bottomLeft");
    assert.equal("bottom" in nearBottom ? nearBottom.bottom : undefined, 58);
    const narrow = canvasSettingsPanelPosition(rect, { width: 320, height: 240 }, "bottomRight");
    assert.equal(narrow.width, 296);
    assert.equal(narrow.left, 12);
    assert.ok(narrow.maxHeight <= 240 - 24);
});
