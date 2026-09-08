import type { AiConfig } from "./ai-config";
import { resolveSelectedModel, type AIModelChoice } from "./model-selection";

export type VideoModelStatus = { videoModels?: AIModelChoice[]; defaultVideoModelId?: string };

export function reconcileVideoConfig(config: AiConfig, status: VideoModelStatus | null | undefined, reset = false): AiConfig {
    // Unknown/loading settings must not erase a saved selection.
    if (!status) return config;
    const model = resolveSelectedModel(status.videoModels, config.videoProviderId, status.defaultVideoModelId);
    const options = model?.videoRequestSchema?.resolutions || [];
    const changedModel = Boolean(model && config.videoProviderId && model.id !== config.videoProviderId);
    const vquality = !reset && !changedModel && options.some((option) => option.value === config.vquality) ? config.vquality : options[0]?.value ?? null;
    const videoProviderId = model?.id || config.videoProviderId;
    return vquality === config.vquality && videoProviderId === config.videoProviderId ? config : { ...config, videoProviderId, vquality };
}
