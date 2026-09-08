"use client";

import { uploadVideoMedia } from "./api/video-media";
import localforage from "localforage";
import { nanoid } from "nanoid";

export type UploadedFile = { mediaId?: string; duration?: number; url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number };

type MediaFileStore = {
    getItem: (key: string) => Promise<Blob | null>;
    setItem: (key: string, blob: Blob) => Promise<unknown>;
    removeItem: (key: string) => Promise<void>;
    iterate: (visit: (blob: Blob, key: string) => void) => Promise<unknown>;
};
export function createFileStorageOperations(store: MediaFileStore, urls = { create: (blob: Blob) => URL.createObjectURL(blob), revoke: (url: string) => URL.revokeObjectURL(url) }) {
    const objectUrls = new Map<string, string>();
    const pending = new Map<string, Promise<unknown>>();
    function withKey<T>(key: string, action: () => Promise<T>): Promise<T> {
        const previous = pending.get(key);
        const result = previous ? previous.catch(() => undefined).then(action) : action();
        pending.set(key, result);
        const release = () => {
            if (pending.get(key) === result) pending.delete(key);
        };
        void result.then(release, release);
        return result;
    }

    async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
        const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
        const storageKey = `${prefix}:${nanoid()}`;
        const url = await withKey(storageKey, async () => {
            await store.setItem(storageKey, blob);
            const next = urls.create(blob);
            const previous = objectUrls.get(storageKey);
            objectUrls.set(storageKey, next);
            if (previous) urls.revoke(previous);
            return next;
        });
        const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : {};
        return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
    }

    async function resolveMediaUrl(storageKey?: string, fallback = "") {
        if (!storageKey) return fallback;
        return withKey(storageKey, async () => {
            const cached = objectUrls.get(storageKey);
            if (cached) return cached;
            const blob = await store.getItem(storageKey);
            if (!blob) return fallback;
            const url = urls.create(blob);
            objectUrls.set(storageKey, url);
            return url;
        });
    }

    async function cleanupUnusedMedia(usedData: unknown) {
        const usedKeys = collectMediaStorageKeys(usedData);
        const unused: Array<{ key: string; url: string | undefined }> = [];
        await store.iterate((_value, key) => {
            if (!usedKeys.has(key)) unused.push({ key, url: objectUrls.get(key) });
        });
        await Promise.all(
            unused.map(({ key, url }) =>
                withKey(key, async () => {
                    // A newer write/resolve means this cleanup snapshot no longer owns the URL.
                    if (objectUrls.get(key) !== url) return;
                    await store.removeItem(key);
                    if (url) urls.revoke(url);
                    objectUrls.delete(key);
                }),
            ),
        );
    }

    return { uploadMediaFile, resolveMediaUrl, cleanupUnusedMedia };
}

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const localFiles = createFileStorageOperations(store);
export const { resolveMediaUrl, cleanupUnusedMedia } = localFiles;
export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    if (prefix === "video" || blob.type.startsWith("video/")) {
        const media = await uploadVideoMedia(blob);
        return { url: media.url, storageKey: "", mediaId: media.mediaId, duration: media.duration, bytes: media.bytes, mimeType: media.contentType, width: media.width, height: media.height };
    }
    return localFiles.uploadMediaFile(blob, prefix);
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720 });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}
