import { OPENROUTER_DEFAULT_BASE_URL, stripTrailingSlashes } from "../config.ts";

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

function liveNameFromRow(item: unknown): { id: string; name: string } | undefined {
	if (typeof item !== "object" || item === null) return undefined;
	const row = item as Record<string, unknown>;
	const id = typeof row.id === "string" ? row.id : "";
	if (!id) return undefined;
	const target = row.alias_target;
	if (typeof target === "object" && target !== null) {
		const name = (target as { name?: unknown }).name;
		const slug = (target as { slug?: unknown }).slug;
		if (typeof name === "string" && name.trim()) {
			return { id, name: displayName(typeof slug === "string" ? slug : id, name) };
		}
	}
	if (typeof row.name === "string" && row.name.trim()) {
		return { id, name: displayName(id, row.name) };
	}
	return undefined;
}

function wordsOf(name: string): string[] {
	return name.toLowerCase().replaceAll("_", " ").replaceAll("-", " ").split(" ").filter(Boolean);
}

/** OpenRouter calls Auto "Auto Router". Product copy is Auto / Auto beta. */
export function prettyLiveModelName(name: string): string {
	const words = wordsOf(name);
	if (!words.includes("auto") || !words.includes("router")) return name;
	return words.includes("beta") ? "Auto beta" : "Auto";
}

/** Human name of the concrete model a `~latest` alias currently resolves to. */
export function parseLiveTargetNames(json: unknown): Map<string, string> {
	const names = new Map<string, string>();
	if (typeof json !== "object" || json === null) return names;
	const data = (json as { data?: unknown }).data;
	if (!Array.isArray(data)) return names;
	for (const item of data) {
		const mapped = liveNameFromRow(item);
		if (mapped) names.set(mapped.id, mapped.name);
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
		const base = stripTrailingSlashes(options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL);
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
