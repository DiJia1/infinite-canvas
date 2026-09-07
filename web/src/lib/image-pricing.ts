import { formatCNYAmount } from "./money";

export type ImageResolutionPrice = { resolution: string; amount: string };

export function formatImagePrices(prices: readonly ImageResolutionPrice[]) {
    if (!prices.length) return "—";
    return prices.map((price) => `${price.resolution} ${formatCNYAmount(price.amount)}`).join(" · ");
}

export function isImageResolutionInput(value: string) {
    const resolution = value.trim();
    return resolution.length > 0 && Array.from(resolution).length <= 64 && !/[\u0000-\u001F\u007F-\u009F]/.test(resolution);
}
