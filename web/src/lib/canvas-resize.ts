export type CanvasResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export function resizeCanvasNode(start: { x: number; y: number; width: number; height: number; corner: CanvasResizeCorner; keepRatio?: boolean; ratio?: number }, delta: { x: number; y: number }, minimum = { width: 220, height: 160 }) {
    const fromLeft = start.corner.includes("left");
    const fromTop = start.corner.includes("top");
    let width = Math.max(minimum.width, start.width + (fromLeft ? -delta.x : delta.x));
    let height = Math.max(minimum.height, start.height + (fromTop ? -delta.y : delta.y));
    if (start.keepRatio) {
        const ratio = start.ratio && start.ratio > 0 ? start.ratio : start.width / Math.max(1, start.height);
        if (Math.abs(delta.x) >= Math.abs(delta.y)) height = width / ratio;
        else width = height * ratio;
        if (height < minimum.height) {
            height = minimum.height;
            width = height * ratio;
        }
        if (width < minimum.width) {
            width = minimum.width;
            height = width / ratio;
        }
    }
    return { width, height, position: { x: fromLeft ? start.x + start.width - width : start.x, y: fromTop ? start.y + start.height - height : start.y } };
}
