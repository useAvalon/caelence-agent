import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { listedMcpCatalog, type McpCatalogEntry } from "../integrations/catalog.ts";
import { connectMcp } from "../integrations/connect.ts";
import { withOAuthLoopback } from "../integrations/loopback.ts";
import { openRemoteMcp } from "../integrations/remote-mcp.ts";
import { listStoredConnections } from "../integrations/store.ts";

export interface CatalogHints {
	id: string;
	label: string;
	aliases: string[];
	domains: string[];
	macAppNames: string[];
}

export interface CatalogMatch {
	id: string;
	label: string;
	exact: boolean;
	connected: boolean;
}

const PREFERENCES = join(homedir(), ".agent", "preferences.json");

function brand(label: string): string {
	return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hostnameOf(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	try {
		if (trimmed.includes("://"))
			return new URL(trimmed).hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		// Keep the raw host.
	}
	return trimmed.replace(/^www\./, "").toLowerCase();
}

function hostBrand(host: string): string {
	return (
		host
			.replace(/^www\./, "")
			.split(".")[0]
			?.toLowerCase()
			.replace(/[^a-z0-9]/g, "") ?? ""
	);
}

/** A name mention that is not part of a longer phrase such as "linear regression". */
export function isolatedName(task: string, name: string): boolean {
	const cleaned = name.trim();
	if (cleaned.length < 3) return false;
	const pattern = new RegExp(`\\b${cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig");
	let found = false;
	for (const match of task.matchAll(pattern)) {
		const after = task.slice((match.index ?? 0) + match[0].length);
		const continues =
			/^\s+[a-z0-9]/i.test(after) &&
			!/^\s+(and|to|for|the|a|an|in|on|app|about|from|with|instead|then|please|too|now)\b/i.test(
				after,
			);
		if (!continues) found = true;
	}
	return found;
}

export function hintsForEntry(entry: McpCatalogEntry): CatalogHints {
	let host = "";
	try {
		host = new URL(entry.mcpUrl).hostname.replace(/^mcp\./, "").replace(/^www\./, "");
	} catch {
		host = "";
	}
	return {
		id: entry.id,
		label: entry.label,
		aliases: [...new Set([entry.id, entry.label.toLowerCase()].filter(Boolean))],
		domains: host ? [host] : [],
		macAppNames: [entry.label],
	};
}

export function decideCatalog(input: {
	task: string;
	host?: string;
	/** A site the user named. The open tab is not a connection target when this is somewhere else. */
	askedHost?: string;
	frontApp?: string;
	entries?: readonly CatalogHints[];
	connectedIds?: ReadonlySet<string>;
	declinedIds?: ReadonlySet<string>;
	nameAnswers?: Readonly<Record<string, boolean>>;
}): CatalogMatch | undefined {
	const entries = input.entries ?? listedMcpCatalog().map(hintsForEntry);
	const connected = input.connectedIds ?? new Set(listStoredConnections().map((row) => row.id));
	const declined = input.declinedIds ?? declinedCatalogIds();
	const host = hostnameOf(input.host ?? "");
	const asked = hostnameOf(input.askedHost ?? "");
	const front = (input.frontApp ?? "").toLowerCase();
	const askedSomewhereElse =
		Boolean(asked) &&
		Boolean(host) &&
		hostBrand(asked) !== hostBrand(host) &&
		!host.endsWith(`.${hostBrand(asked)}`);
	const named = entries.find((entry) => {
		if (declined.has(entry.id)) return false;
		const names = [entry.label, ...entry.aliases];
		if (!names.some((name) => isolatedName(input.task, name))) return false;
		if (input.nameAnswers?.[entry.id] === false) return false;
		if (input.nameAnswers && input.nameAnswers[entry.id] !== true) return false;
		return true;
	});
	if (named) {
		return {
			id: named.id,
			label: named.label,
			exact: false,
			connected: connected.has(named.id),
		};
	}
	if (askedSomewhereElse) return undefined;
	for (const entry of entries) {
		if (declined.has(entry.id)) continue;
		const exactHost =
			Boolean(host) &&
			(entry.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)) ||
				hostBrand(host) === brand(entry.label));
		const exactApp = entry.macAppNames.some((name) => name.toLowerCase() === front);
		if (exactHost || exactApp) {
			return { id: entry.id, label: entry.label, exact: true, connected: connected.has(entry.id) };
		}
	}
	return undefined;
}

export function declinedCatalogIds(): Set<string> {
	try {
		const parsed = JSON.parse(readFileSync(PREFERENCES, "utf8")) as { declined?: unknown };
		if (!Array.isArray(parsed.declined)) return new Set();
		return new Set(parsed.declined.filter((item) => typeof item === "string"));
	} catch {
		return new Set();
	}
}

export function declineCatalog(id: string): void {
	const current = declinedCatalogIds();
	current.add(id);
	mkdirSync(join(homedir(), ".agent"), { recursive: true });
	const previous = existsSync(PREFERENCES)
		? (JSON.parse(readFileSync(PREFERENCES, "utf8")) as Record<string, unknown>)
		: {};
	writeFileSync(
		PREFERENCES,
		`${JSON.stringify({ ...previous, declined: [...current] }, null, "\t")}\n`,
	);
}

export function pickCreateTool<T extends { name: string; description?: string }>(
	tools: readonly T[],
): T | undefined {
	let best: { tool: T; score: number } | undefined;
	for (const tool of tools) {
		const name = tool.name.toLowerCase();
		if (/search|fetch|get|list|query|read/.test(name)) continue;
		let score = 0;
		if (/create|add|new/.test(name) && /page|note|doc|message/.test(name)) score = 5;
		else if (/create|add|new/.test(name)) score = 3;
		if (!best || score > best.score) best = { tool, score };
	}
	return best && best.score > 0 ? best.tool : undefined;
}

/** Fill a create tool from its schema. A `pages` array gets a title and the body. */
export function argumentsForCreate(
	schema: Record<string, unknown>,
	title: string,
	body: string,
): Record<string, unknown> {
	const properties =
		schema.properties && typeof schema.properties === "object"
			? (schema.properties as Record<string, unknown>)
			: {};
	const args: Record<string, unknown> = {};
	for (const key of Object.keys(properties)) {
		const name = key.toLowerCase();
		if (name === "pages") {
			args[key] = [{ properties: { title }, content: body }];
			continue;
		}
		if (/title|name/.test(name) && !/parent|database/.test(name)) args[key] = title;
		else if (/content|body|markdown|text/.test(name)) args[key] = body;
	}
	if (Object.keys(args).length === 0) {
		args.pages = [{ properties: { title }, content: body }];
	}
	return args;
}

const CHROME_WORDS = new Set(["breaking", "news", "latest", "top", "stories", "headlines", "and"]);

function compactCopy(value: string): string {
	return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function dropInstruction(task: string, body: string): string {
	const ask = task.trim();
	if (ask.length < 12) return body;
	const escaped = ask.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return body
		.replace(new RegExp(escaped, "ig"), "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function onlySiteChrome(text: string): boolean {
	const words = compactCopy(text)
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	return words.length > 0 && words.every((word) => CHROME_WORDS.has(word));
}

export function catalogPageBody(task: string, body: string): string | undefined {
	const raw = body.trim();
	if (!raw || raw === "EMPTY") return undefined;
	const text = dropInstruction(task, raw);
	if (!text || text === "EMPTY") return undefined;
	const droppedAsk = text.length < raw.length;
	const ask = compactCopy(task);
	const page = compactCopy(text);
	if (page === ask) return undefined;
	if (onlySiteChrome(text)) return undefined;
	if (droppedAsk && page.length < 40) return undefined;
	if (ask.includes(page) && text.length < 160) return undefined;
	if (page.includes(ask) && text.length - ask.length < 80) return undefined;
	return text;
}

export function catalogFailureSummary(label: string, err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	if (/401|403|unauthor|expired|invalid.?token|invalid_grant/i.test(msg)) {
		return `The ${label} connection expired. Reconnect it in Settings.`;
	}
	if (/abort|timed? ?out/i.test(msg)) {
		return `${label} didn't respond. Reconnect it in Settings if this keeps happening.`;
	}
	return `Couldn't reach ${label}.`;
}

/** First markdown heading the draft already wrote. Empty if the model did not title it. */
export function pageTitle(body: string): string {
	for (const raw of body.split("\n")) {
		const heading = raw.trim().match(/^#+\s+(.+)$/);
		const title = heading?.[1]?.trim();
		if (title) return title.slice(0, 90);
	}
	return "";
}

/** First page address in a tool result, skipping the connection's own host. */
export function createdPageUrl(text: string): string | undefined {
	const urls = text.match(/https?:\/\/[^\s)"']+/gi) ?? [];
	const page = urls.find((url) => !/mcp\./i.test(url));
	return page?.replace(/[)\].,>]+$/g, "");
}

/** Use a connected server's create tool. Undefined means there is no create tool, so the screen path can try. */
export async function runConnectedCatalog(
	id: string,
	task: string,
	body = "",
): Promise<{ ok: boolean; summary: string; url?: string } | undefined> {
	const row = listStoredConnections().find((item) => item.id === id);
	if (!row) return undefined;
	const text = catalogPageBody(task, body);
	if (!text) {
		return {
			ok: false,
			summary: `I didn't have page text to save in ${row.label}.`,
		};
	}
	try {
		const signal = AbortSignal.timeout(12_000);
		const client = await openRemoteMcp({
			mcpUrl: row.mcpUrl,
			accessToken: row.accessToken,
			signal,
		});
		const tools = await client.listTools();
		const tool = pickCreateTool(tools);
		if (!tool) {
			return {
				ok: false,
				summary: `${row.label} is connected, but it has no create-page tool.`,
			};
		}
		const result = await client.callTool(
			tool.name,
			argumentsForCreate(tool.inputSchema, pageTitle(text), text),
		);
		const raw = result.content
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (result.isError) {
			return {
				ok: false,
				summary: catalogFailureSummary(row.label, raw || "create failed"),
			};
		}
		return { ok: true, summary: `The page is in ${row.label}.`, url: createdPageUrl(raw) };
	} catch (err) {
		return { ok: false, summary: catalogFailureSummary(row.label, err) };
	}
}

export async function connectCatalog(id: string): Promise<void> {
	await withOAuthLoopback(async ({ redirectUri, waitForCallback }) => {
		await connectMcp({ connectorId: id, redirectUri, waitForCallback });
	});
}

/** WebMCP tools registered on the open page. Missing support returns an empty list. */
export async function readWebMcpTools(
	evaluate: (source: string) => Promise<unknown>,
): Promise<string[]> {
	try {
		const value = await evaluate(
			`(() => { const testing = navigator.modelContextTesting; if (!testing || typeof testing.getTools !== "function") return []; return testing.getTools().map((tool) => tool && tool.name).filter((name) => typeof name === "string"); })()`,
		);
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}
