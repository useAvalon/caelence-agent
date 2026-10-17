import { OPENROUTER_DEFAULT_BASE_URL } from "../config.ts";
import {
	IMAGE_MODELS,
	type MediaModelOption,
	TRANSCRIBE_MODELS,
	VIDEO_MODELS,
} from "./media-models.ts";

export type MediaModality = "image" | "video" | "transcription";

const LIVE_TTL_MS = 10 * 60 * 1000;
const caches = new Map<MediaModality, { expires: number; items: MediaModelOption[] }>();

function displayName(id: string, rawName: string): string {
	const trimmed = rawName.trim();
	if (!trimmed) return id;
	const colon = trimmed.indexOf(": ");
	return colon >= 0 ? trimmed.slice(colon + 2) : trimmed;
}

export function fallbackModels(modality: MediaModality): readonly MediaModelOption[] {
	if (modality === "image") return IMAGE_MODELS;
	if (modality === "video") return VIDEO_MODELS;
	return TRANSCRIBE_MODELS;
}

/** Parse `GET /models?output_modalities=` into picker rows. */
export function parseModalityModels(json: unknown): MediaModelOption[] {
	if (typeof json !== "object" || json === null) return [];
	const data = (json as { data?: unknown }).data;
	if (!Array.isArray(data)) return [];
	const items: MediaModelOption[] = [];
	const seen = new Set<string>();
	for (const item of data) {
		if (typeof item !== "object" || item === null) continue;
		const row = item as Record<string, unknown>;
		const id = typeof row.id === "string" ? row.id.trim() : "";
		if (!id || id.includes(":batch") || seen.has(id)) continue;
		seen.add(id);
		const name = typeof row.name === "string" ? displayName(id, row.name) : id;
		items.push({ id, label: name });
	}
	return items;
}

export function cachedModalityModels(modality: MediaModality): readonly MediaModelOption[] {
	return caches.get(modality)?.items ?? fallbackModels(modality);
}

export async function loadModalityModels(options: {
	modality: MediaModality;
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}): Promise<readonly MediaModelOption[]> {
	const fallback = fallbackModels(options.modality);
	if (!options.apiKey.trim()) return fallback;
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const useCache = fetchImpl === globalThis.fetch;
	const cached = caches.get(options.modality);
	if (useCache && cached && cached.expires > Date.now()) return cached.items;
	try {
		const base = (options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
		const res = await fetchImpl(
			`${base}/models?output_modalities=${encodeURIComponent(options.modality)}`,
			{
				headers: {
					Authorization: `Bearer ${options.apiKey}`,
					"HTTP-Referer": "https://caelence.com",
					"X-Title": "Caelence agent",
				},
				signal: AbortSignal.timeout(4_000),
			},
		);
		if (!res.ok) return cached?.items ?? fallback;
		const items = parseModalityModels(await res.json());
		if (items.length === 0) return cached?.items ?? fallback;
		if (useCache) caches.set(options.modality, { expires: Date.now() + LIVE_TTL_MS, items });
		return items;
	} catch {
		return cached?.items ?? fallback;
	}
}
