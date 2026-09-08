import axios from "axios";
import { aiApiPath } from "./request";

export type VideoMediaAccess = { mediaId: string; url: string; previewUrl?: string; contentType: string; bytes: number; width: number; height: number; duration: number; expiresAt?: string };
type Envelope<T> = { code: number; msg?: string; data?: T };
export class VideoMediaRequestError extends Error {}
function data<T>(value: Envelope<T>): T {
    if (value.code !== 0 || !value.data) throw new VideoMediaRequestError(value.msg || "视频素材请求失败");
    return value.data;
}
export async function uploadVideoMedia(file: Blob, signal?: AbortSignal): Promise<VideoMediaAccess> {
    if (file.type !== "video/mp4" || !file.size || file.size > 50 * 1024 * 1024) throw new Error("请上传不超过 50 MB 的 MP4 视频");
    const intent = data(
        (
            await axios.post<Envelope<{ mode: string; id: string; uploadUrl: string }>>(
                aiApiPath("/media/upload-intents"),
                {
                    filename: file instanceof File ? file.name : "video.mp4",
                    contentType: file.type,
                    bytes: file.size,
                    intent: "canvas",
                },
                { signal },
            )
        ).data,
    );
    if (intent.mode !== "direct" || !intent.id || !intent.uploadUrl) throw new Error("视频上传需要 OSS 存储");
    const result = await fetch(intent.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type }, signal });
    if (!result.ok) throw new Error(`视频上传失败：${result.status}`);
    return data((await axios.post<Envelope<VideoMediaAccess>>(aiApiPath(`/media/upload-intents/${encodeURIComponent(intent.id)}/complete`), undefined, { signal })).data);
}
export async function getVideoMediaAccess(mediaId: string, signal?: AbortSignal): Promise<VideoMediaAccess> {
    return data((await axios.get<Envelope<VideoMediaAccess>>(aiApiPath(`/media/${encodeURIComponent(mediaId)}/access`), { signal, timeout: 20_000 })).data);
}

export async function getVideoDownloadAccess(mediaId: string, filename: string): Promise<VideoMediaAccess> {
    return data((await axios.get<Envelope<VideoMediaAccess>>(aiApiPath(`/media/${encodeURIComponent(mediaId)}/access`), { params: { download: "1", filename }, timeout: 20_000 })).data);
}
