export type WorkflowViewportElement = {
    clientWidth: number;
    clientHeight: number;
};

type WorkflowResizeObserver<T> = {
    observe: (element: T) => void;
    disconnect: () => void;
};

export function observeWorkflowViewport<T extends WorkflowViewportElement>(element: T | null, onSize: (size: { width: number; height: number }) => void, createObserver: (update: () => void) => WorkflowResizeObserver<T>) {
    if (!element) return () => undefined;
    const update = () => onSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = createObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
}
