import { OPENROUTER_DEFAULT_BASE_URL, stripTrailingSlashes } from "../config.ts";

/** Alpha Decisions API lives at `/api/alpha/decisions`, not under `/api/v1`. */
export function openRouterDecisionsUrl(baseUrl?: string): string {
	const raw = baseUrl?.trim() || OPENROUTER_DEFAULT_BASE_URL;
	if (/openrouter\.ai/i.test(raw)) return "https://openrouter.ai/api/alpha/decisions";
	return `${stripTrailingSlashes(raw).replace(/\/v1$/, "")}/api/alpha/decisions`;
}
