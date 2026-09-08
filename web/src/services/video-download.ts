import { saveAs } from "file-saver";
import { getVideoDownloadAccess } from "./api/video-media";
import { appApiPath } from "@/lib/app-path";

export async function downloadVideo(mediaId: string | undefined, localURL: string | undefined, filename: string) {
    if (!mediaId) {
        if (!localURL?.startsWith("blob:")) throw new Error("视频尚未就绪");
        saveAs(localURL, filename);
        return;
    }
    const { url } = await getVideoDownloadAccess(mediaId, filename);
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "视频下载";
    // Local media URLs are relative to the application's gateway mount.
    frame.src = url.startsWith("/api/") ? appApiPath(url) : url;
    document.body.appendChild(frame);
    // Attachment responses do not reliably emit a load event.
    setTimeout(() => frame.remove(), 120_000);
}
