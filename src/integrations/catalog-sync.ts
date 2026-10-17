import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MCP_CATALOG, type McpAuthKind, type McpCatalogEntry, setLiveCatalog } from "./catalog.ts";

export interface CatalogSeed {
	name: string;
	docsUrl: string;
}

export type ProbeAuth = "dcr" | "oauth_preregistered" | "unreachable";

export interface CachedCatalogEntry extends McpCatalogEntry {
	authProbe?: ProbeAuth;
	summary?: string;
	plan?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function cachePath(): string {
	return join(homedir(), ".agent", "catalog-cache.json");
}

function seedPath(): string {
	return join(import.meta.dir, "catalog-seed.json");
}

export function loadCatalogSeed(): CatalogSeed[] {
	const shipped: CatalogSeed[] = MCP_CATALOG.map((row) => ({
		name: row.label,
		docsUrl: row.docsUrl,
	}));
	try {
		const extra = JSON.parse(readFileSync(seedPath(), "utf8")) as CatalogSeed[];
		return [...shipped, ...extra.filter((row) => !shipped.some((item) => item.name === row.name))];
	} catch {
		return shipped;
	}
}

export function extractMcpUrl(text: string): string | undefined {
	const match = text.match(/https:\/\/mcp\.[a-z0-9.-]+\/mcp/i);
	return match?.[0]?.replace(/[)\].,>]+$/g, "");
}

export function domainKey(url: string): string {
	try {
		return new URL(url).hostname
			.replace(/^mcp\./, "")
			.replace(/^www\./, "")
			.toLowerCase();
	} catch {
		return url.toLowerCase();
	}
}

export function mergeCatalog(
	seed: readonly McpCatalogEntry[],
	incoming: readonly McpCatalogEntry[],
): McpCatalogEntry[] {
	const byKey = new Map<string, McpCatalogEntry>();
	for (const row of seed) {
		byKey.set(domainKey(row.mcpUrl) || row.id, row);
	}
	for (const row of incoming) {
		byKey.set(domainKey(row.mcpUrl) || row.id, row);
	}
	return [...byKey.values()];
}

export function entryFromSeed(
	seed: CatalogSeed,
	mcpUrl: string,
	auth?: McpAuthKind,
): McpCatalogEntry {
	const id = seed.name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return {
		id,
		label: seed.name,
		description: seed.name,
		mcpUrl,
		docsUrl: seed.docsUrl,
		glyph: seed.name.slice(0, 2),
		scopes: [],
		...(auth ? { auth } : {}),
	};
}

export async function probeMcpAuth(
	mcpUrl: string,
	fetchImpl: FetchLike = fetch,
): Promise<ProbeAuth> {
	try {
		const res = await fetchImpl(mcpUrl, {
			method: "GET",
			headers: { Accept: "text/event-stream" },
			signal: AbortSignal.timeout(8_000),
		});
		const www = res.headers.get("www-authenticate") ?? "";
		const resource = res.headers.get("resource-metadata") ?? "";
		if (/resource_metadata|protected.resource|DCR|dynamic.?client/i.test(`${www} ${resource}`)) {
			return "dcr";
		}
		if (res.status === 401 || res.status === 403) return "oauth_preregistered";
		if (!res.ok && res.status >= 500) return "unreachable";
		return res.ok ? "dcr" : "oauth_preregistered";
	} catch {
		return "unreachable";
	}
}

interface RegistryServer {
	name?: string;
	title?: string;
	description?: string;
	remotes?: Array<{ url?: string }>;
	websiteUrl?: string;
}

export function entriesFromRegistry(json: unknown): McpCatalogEntry[] {
	const servers =
		json && typeof json === "object" && Array.isArray((json as { servers?: unknown }).servers)
			? (json as { servers: RegistryServer[] }).servers
			: Array.isArray(json)
				? (json as RegistryServer[])
				: [];
	const out: McpCatalogEntry[] = [];
	for (const row of servers) {
		const url = row.remotes?.find((item) => item.url)?.url?.trim();
		if (!url || !/^https:\/\//i.test(url)) continue;
		const name = (row.title || row.name || domainKey(url)).trim();
		if (!name) continue;
		out.push(entryFromSeed({ name, docsUrl: row.websiteUrl || url }, url));
	}
	return out;
}

export async function syncCatalog(options?: {
	fetchImpl?: FetchLike;
	now?: number;
	force?: boolean;
	cacheFile?: string;
}): Promise<CachedCatalogEntry[]> {
	const now = options?.now ?? Date.now();
	const file = options?.cacheFile ?? cachePath();
	if (!options?.force && existsSync(file)) {
		try {
			const parsed = JSON.parse(readFileSync(file, "utf8")) as {
				at?: number;
				entries?: CachedCatalogEntry[];
			};
			if (parsed.at && now - parsed.at < DAY_MS && Array.isArray(parsed.entries)) {
				setLiveCatalog(parsed.entries);
				return parsed.entries;
			}
		} catch {
			// Rebuild.
		}
	}
	const fetchImpl = options?.fetchImpl ?? fetch;
	const seedEntries = [...MCP_CATALOG];
	const extraSeed = loadCatalogSeed().filter(
		(row) => !seedEntries.some((item) => item.label === row.name),
	);
	for (const row of extraSeed) {
		const page = await fetchImpl(row.docsUrl, { signal: AbortSignal.timeout(8_000) })
			.then((res) => res.text())
			.catch(() => "");
		const mcpUrl =
			extractMcpUrl(`${row.docsUrl}\n${page}`) ??
			(row.docsUrl.includes("/mcp") ? row.docsUrl : undefined);
		if (!mcpUrl) continue;
		seedEntries.push(entryFromSeed(row, mcpUrl));
	}
	let registry: McpCatalogEntry[] = [];
	try {
		const res = await fetchImpl(REGISTRY_URL, { signal: AbortSignal.timeout(8_000) });
		if (res.ok) registry = entriesFromRegistry(await res.json());
	} catch {
		registry = [];
	}
	const merged = mergeCatalog(seedEntries, registry);
	const probed: CachedCatalogEntry[] = [];
	for (const row of merged) {
		const authProbe = await probeMcpAuth(row.mcpUrl, fetchImpl);
		probed.push({
			...row,
			authProbe,
			summary: row.description,
			plan: `Connect ${row.label} at ${row.mcpUrl}.`,
		});
	}
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `${JSON.stringify({ at: now, entries: probed }, null, "\t")}\n`);
	} catch {
		// Cache is optional.
	}
	setLiveCatalog(probed);
	return probed;
}

export function connectionSetup(item: {
	connected: boolean;
	auth?: McpAuthKind;
	authProbe?: ProbeAuth;
}): "connected" | "dcr" | "needs_setup" {
	if (item.connected) return "connected";
	if (item.auth === "google" || item.auth === "microsoft") return "needs_setup";
	return "dcr";
}
