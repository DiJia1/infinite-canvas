import type { UserImageUploadOptions } from "@/services/api/image";
import type { UploadedImage } from "@/services/image-storage";

export type LocalImageUploadIntent = "canvas" | "library";

type UploadedRemoteImage = {
    mediaId: string;
    url: string;
    mediaExpiresAt?: string;
};

type LocalImageUploadTask = {
    nodeId: string;
    file: File;
    image: UploadedImage;
    intent: LocalImageUploadIntent;
    scope?: string;
};

type CanvasLocalImageUploadControllerOptions = {
    upload: (file: File, intent: LocalImageUploadIntent, options: UserImageUploadOptions) => Promise<UploadedRemoteImage>;
    promote: (image: UploadedImage, mediaId: string) => Promise<UploadedImage>;
    onProgress: (nodeId: string, progress: number, source: LocalImageUploadTask) => void;
    onCompleted: (nodeId: string, image: UploadedImage, remote: UploadedRemoteImage, source: LocalImageUploadTask) => void;
    onFailed: (nodeId: string, error: string, source: LocalImageUploadTask) => void;
};

function isUploadAbort(error: unknown) {
    return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

export function createCanvasLocalImageUploadController(options: CanvasLocalImageUploadControllerOptions) {
    const active = new Map<string, AbortController>();

    const start = async (source: LocalImageUploadTask) => {
        const { nodeId, file, image, intent } = source;
        active.get(nodeId)?.abort();
        const controller = new AbortController();
        active.set(nodeId, controller);
        try {
            const remote = await options.upload(file, intent, {
                signal: controller.signal,
                onProgress: (progress) => {
                    if (active.get(nodeId) === controller && !controller.signal.aborted) options.onProgress(nodeId, progress, source);
                },
            });
            if (active.get(nodeId) !== controller || controller.signal.aborted) return;
            const promoted = await options.promote(image, remote.mediaId);
            if (active.get(nodeId) !== controller || controller.signal.aborted) return;
            options.onCompleted(nodeId, promoted, remote, source);
        } catch (error) {
            if (active.get(nodeId) === controller && !controller.signal.aborted && !isUploadAbort(error)) options.onFailed(nodeId, error instanceof Error ? error.message : "上传图片失败", source);
        } finally {
            if (active.get(nodeId) === controller) active.delete(nodeId);
        }
    };

    return {
        start,
        cancel: (nodeId: string) => {
            const controller = active.get(nodeId);
            active.delete(nodeId);
            controller?.abort();
        },
        isActive: (nodeId: string) => active.has(nodeId),
        dispose: () => {
            const controllers = [...active.values()];
            active.clear();
            controllers.forEach((controller) => controller.abort());
        },
    };
}
