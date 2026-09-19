import { OPENROUTER_DEFAULT_BASE_URL } from "../config.ts";

const LIVE_TTL_MS = 10 * 60 * 1000;
const EMPTY = new Map<string, string>();

let cache: { expires: number; names: Map<string, string> } | null = null;

function displayName(id: string, rawName: string): string {
	const trimmed = rawName.trim();
	if (!trimmed) return id;
	const colon = trimmed.indexOf(": ");
	const name = colon >= 0 ? trimmed.slice(colon + 2) : trimmed;
	return prettyLiveModelName(name);
}

/** OpenRouter calls Auto "Auto Router". Product copy is Auto / Auto beta. */
export function prettyLiveModelName(name: string): string {
	const lower = name.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
	if (!/\bauto\b/.test(lower) || !/\brouter\b/.test(lower)) return name;
	return /\bbeta\b/.test(lower) ? "Auto beta" : "Auto";
}

/** Human name of the concrete model a `~latest` alias currently resolves to. */
export function parseLiveTargetNames(json: unknown): Map<string, string> {
	const names = new Map<string, string>();
	if (typeof json !== "object" || json === null) return names;
	const data = (json as { data?: unknown }).data;
	if (!Array.isArray(data)) return names;
	for (const item of data) {
		if (typeof item !== "object" || item === null) continue;
		const row = item as Record<string, unknown>;
		const id = typeof row.id === "string" ? row.id : "";
		if (!id) continue;
		const target = row.alias_target;
		if (typeof target === "object" && target !== null) {
			const name = (target as { name?: unknown }).name;
			const slug = (target as { slug?: unknown }).slug;
			if (typeof name === "string" && name.trim()) {
				names.set(id, displayName(typeof slug === "string" ? slug : id, name));
				continue;
			}
		}
		if (typeof row.name === "string" && row.name.trim()) {
			names.set(id, displayName(id, row.name));
		}
	}
	return names;
}

export function cachedLiveTargetNames(): ReadonlyMap<string, string> {
	return cache?.names ?? EMPTY;
}

export async function loadLiveTargetNames(options: {
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}): Promise<ReadonlyMap<string, string>> {
	if (!options.apiKey.trim()) return EMPTY;
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const useCache = fetchImpl === globalThis.fetch;
	if (useCache && cache && cache.expires > Date.now()) return cache.names;
	try {
		const base = (options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
		const res = await fetchImpl(`${base}/models`, {
			headers: {
				Authorization: `Bearer ${options.apiKey}`,
				"HTTP-Referer": "https://caelence.com",
				"X-Title": "Caelence agent",
			},
			signal: AbortSignal.timeout(4_000),
		});
		if (!res.ok) return cache?.names ?? EMPTY;
		const names = parseLiveTargetNames(await res.json());
		if (useCache) cache = { expires: Date.now() + LIVE_TTL_MS, names };
		return names;
	} catch {
		return cache?.names ?? EMPTY;
	}
}
