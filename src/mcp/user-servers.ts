import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ExtraMcpServerConfig } from "../config.ts";

export type UserMcpKind = "stdio" | "http";

export interface UserMcpServer {
	id: string;
	label: string;
	kind: UserMcpKind;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	token?: string;
}

export interface PublicUserMcp {
	id: string;
	label: string;
	kind: UserMcpKind;
	detail: string;
	origin: "user" | "config";
	removable: boolean;
}

export interface AddUserMcpInput {
	label?: string;
	kind?: string;
	command?: string;
	args?: string | string[];
	url?: string;
	token?: string;
	env?: Record<string, string>;
}

interface StoreFile {
	servers: UserMcpServer[];
}

export function userMcpPath(cwd: string): string {
	return resolve(cwd, ".harness", "mcp.json");
}

export function userMcpToolPrefix(id: string): string {
	const slug = id.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	return `mcp_${slug || "server"}`;
}

export function splitMcpArgs(raw: string): string[] {
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|[^\s]+/g;
	for (const match of raw.matchAll(re)) {
		const part = match[1] ?? match[2] ?? match[0];
		if (part) out.push(part);
	}
	return out;
}

export function isHttpMcpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function looksLikeJsonObject(raw: string): boolean {
	const trimmed = raw.trim();
	return trimmed.startsWith("{") && trimmed.endsWith("}");
}

function tokenFromHeaders(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const headers = value as Record<string, unknown>;
	const auth = headers.Authorization ?? headers.authorization;
	if (typeof auth !== "string") return undefined;
	return auth.replace(/^Bearer\s+/i, "").trim() || undefined;
}

function mcpEntryToInput(name: string, value: unknown): AddUserMcpInput | { error: string } {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { error: "MCP server config is not valid." };
	}
	const row = value as Record<string, unknown>;
	const label =
		name.trim() || (typeof row.name === "string" ? row.name.trim() : undefined) || undefined;
	const url =
		typeof row.url === "string"
			? row.url.trim()
			: typeof row.serverUrl === "string"
				? row.serverUrl.trim()
				: "";
	if (url) {
		const token =
			(typeof row.token === "string" ? row.token.trim() : "") || tokenFromHeaders(row.headers);
		return { kind: "http", ...(label ? { label } : {}), url, ...(token ? { token } : {}) };
	}
	const command = typeof row.command === "string" ? row.command.trim() : "";
	if (!command) {
		return { error: `${label || "MCP"} needs a command or URL.` };
	}
	const args = Array.isArray(row.args)
		? row.args.filter((part): part is string => typeof part === "string")
		: [];
	const env = asEnv(row.env);
	return {
		kind: "stdio",
		...(label ? { label } : {}),
		command,
		...(args.length > 0 ? { args } : {}),
		...(env ? { env } : {}),
	};
}

function mcpServerMap(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

export function parseMcpServersJson(raw: string): { ok: AddUserMcpInput[] } | { error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return { error: "MCP JSON is not valid." };
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { error: "MCP JSON needs a command, URL, or mcpServers map." };
	}
	const row = parsed as Record<string, unknown>;
	const grouped = mcpServerMap(row.mcpServers) ?? mcpServerMap(row.servers);
	const entries = grouped
		? Object.entries(grouped)
		: typeof row.command === "string" ||
				typeof row.url === "string" ||
				typeof row.serverUrl === "string"
			? [["", parsed] as [string, unknown]]
			: [];
	if (entries.length === 0) {
		return { error: "MCP JSON needs a command, URL, or mcpServers map." };
	}
	const out: AddUserMcpInput[] = [];
	for (const [name, value] of entries) {
		const input = mcpEntryToInput(name, value);
		if ("error" in input) return input;
		out.push(input);
	}
	return { ok: out };
}

export function expandMcpAddInput(
	raw: AddUserMcpInput,
): { ok: AddUserMcpInput[] } | { error: string } {
	const command = typeof raw.command === "string" ? raw.command.trim() : "";
	if (!looksLikeJsonObject(command)) return { ok: [raw] };
	const parsed = parseMcpServersJson(command);
	if ("error" in parsed) return parsed;
	if (raw.label?.trim() && parsed.ok.length === 1) {
		const first = parsed.ok[0];
		if (first && !first.label) return { ok: [{ ...first, label: raw.label.trim() }] };
	}
	return parsed;
}

function readStore(cwd: string): StoreFile {
	const path = userMcpPath(cwd);
	if (!existsSync(path)) return { servers: [] };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as StoreFile;
		if (!parsed || !Array.isArray(parsed.servers)) return { servers: [] };
		return { servers: parsed.servers.filter(isUserMcpServer) };
	} catch {
		return { servers: [] };
	}
}

function isUserMcpServer(value: unknown): value is UserMcpServer {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	if (typeof row.id !== "string" || !row.id.trim()) return false;
	if (typeof row.label !== "string" || !row.label.trim()) return false;
	if (row.kind === "stdio") {
		return typeof row.command === "string" && row.command.trim().length > 0;
	}
	if (row.kind === "http") {
		return typeof row.url === "string" && isHttpMcpUrl(row.url.trim());
	}
	return false;
}

function writeStore(cwd: string, store: StoreFile): void {
	const path = userMcpPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(store, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		// best-effort on filesystems that ignore mode
	}
}

export function listUserMcpServers(cwd: string): UserMcpServer[] {
	return readStore(cwd).servers;
}

function slugMcpId(label: string, existing: string[]): string {
	const base =
		label
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "mcp";
	const taken = new Set(existing);
	if (!taken.has(base) && !base.startsWith("config-")) return base;
	let n = 2;
	while (taken.has(`${base}-${n}`)) n += 1;
	return `${base}-${n}`;
}

function asStringList(value: string | string[] | undefined): string[] {
	if (Array.isArray(value)) {
		return value.map((part) => part.trim()).filter(Boolean);
	}
	if (typeof value === "string") return splitMcpArgs(value);
	return [];
}

function asEnv(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (!key.trim() || typeof entry !== "string") continue;
		out[key] = entry;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function defaultLabel(kind: UserMcpKind, command: string, args: string[], url: string): string {
	if (kind === "http") {
		try {
			return new URL(url).hostname || "MCP";
		} catch {
			return "MCP";
		}
	}
	const pkg = args.find((part) => part.startsWith("@") || part.toLowerCase().includes("mcp"));
	return pkg ?? command;
}

function stdioFingerprint(command: string, args: string[]): string {
	return `stdio:${command}\0${args.join("\0")}`;
}

function httpFingerprint(url: string): string {
	return `http:${url}`;
}

function configFingerprints(configMcp: ExtraMcpServerConfig[]): Set<string> {
	return new Set(configMcp.map((mcp) => stdioFingerprint(mcp.command, mcp.args ?? [])));
}

function parseMcpKind(raw: string | undefined): UserMcpKind | null {
	if (!raw || raw === "stdio") return "stdio";
	if (raw === "http") return "http";
	return null;
}

export function parseAddUserMcp(
	raw: AddUserMcpInput,
	existing: UserMcpServer[],
	configMcp: ExtraMcpServerConfig[] = [],
): { ok: UserMcpServer } | { error: string } {
	const kind = parseMcpKind(raw.kind);
	if (!kind) return { error: "kind must be stdio or http." };

	if (kind === "http") {
		const url = typeof raw.url === "string" ? raw.url.trim() : "";
		if (!url) return { error: "URL is required." };
		if (!isHttpMcpUrl(url)) return { error: "URL must be http or https." };
		const token = typeof raw.token === "string" ? raw.token.trim() : "";
		const print = httpFingerprint(url);
		if (
			existing.some(
				(server) => server.kind === "http" && httpFingerprint(server.url ?? "") === print,
			)
		) {
			return { error: "That MCP is already added." };
		}
		const label =
			(typeof raw.label === "string" ? raw.label.trim() : "") || defaultLabel("http", "", [], url);
		const id = slugMcpId(
			label,
			existing.map((server) => server.id),
		);
		return {
			ok: {
				id,
				label,
				kind: "http",
				url,
				...(token ? { token } : {}),
			},
		};
	}

	const givenCommand = typeof raw.command === "string" ? raw.command.trim() : "";
	if (!givenCommand) return { error: "Command is required." };
	let command = givenCommand;
	let args = asStringList(raw.args);
	if (args.length === 0 && command.includes(" ")) {
		const parts = splitMcpArgs(command);
		command = parts[0] ?? "";
		args = parts.slice(1);
	}
	if (!command) return { error: "Command is required." };
	if (command.includes("\0") || args.some((part) => part.includes("\0"))) {
		return { error: "Command is not valid." };
	}

	const print = stdioFingerprint(command, args);
	if (configFingerprints(configMcp).has(print)) {
		return { error: "That MCP is already in harness.config.ts." };
	}
	if (
		existing.some(
			(server) =>
				server.kind === "stdio" &&
				stdioFingerprint(server.command ?? "", server.args ?? []) === print,
		)
	) {
		return { error: "That MCP is already added." };
	}

	const env = asEnv(raw.env);
	const label =
		(typeof raw.label === "string" ? raw.label.trim() : "") ||
		defaultLabel("stdio", command, args, "");
	const id = slugMcpId(
		label,
		existing.map((server) => server.id),
	);
	return {
		ok: {
			id,
			label,
			kind: "stdio",
			command,
			...(args.length > 0 ? { args } : {}),
			...(env ? { env } : {}),
		},
	};
}

export function addUserMcpServer(
	cwd: string,
	raw: AddUserMcpInput,
	configMcp: ExtraMcpServerConfig[] = [],
): { ok: UserMcpServer } | { error: string } {
	const expanded = expandMcpAddInput(raw);
	if ("error" in expanded) return expanded;
	const store = readStore(cwd);
	let existing = store.servers;
	const added: UserMcpServer[] = [];
	let lastError: string | undefined;
	for (const input of expanded.ok) {
		const parsed = parseAddUserMcp(input, existing, configMcp);
		if ("error" in parsed) {
			lastError = parsed.error;
			continue;
		}
		existing = [...existing, parsed.ok];
		added.push(parsed.ok);
	}
	if (added.length === 0) return { error: lastError ?? "No MCP servers to add." };
	writeStore(cwd, { servers: existing });
	const last = added[added.length - 1];
	if (!last) return { error: lastError ?? "No MCP servers to add." };
	return { ok: last };
}

export function removeUserMcpServer(cwd: string, id: string): boolean {
	const key = id.trim();
	if (!key || key.startsWith("config-")) return false;
	const store = readStore(cwd);
	const next = store.servers.filter((server) => server.id !== key);
	if (next.length === store.servers.length) return false;
	writeStore(cwd, { servers: next });
	return true;
}

function publicDetail(server: UserMcpServer): string {
	if (server.kind === "http") {
		const url = server.url ?? "";
		return server.token ? `${url} · token set` : url;
	}
	return [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
}

export function toPublicUserMcp(server: UserMcpServer): PublicUserMcp {
	return {
		id: server.id,
		label: server.label,
		kind: server.kind,
		detail: publicDetail(server),
		origin: "user",
		removable: true,
	};
}

export function listPublicMcps(
	cwd: string,
	configMcp: ExtraMcpServerConfig[] = [],
): PublicUserMcp[] {
	const user = listUserMcpServers(cwd).map(toPublicUserMcp);
	const config = configMcp.map((mcp, index) => ({
		id: `config-${index}`,
		label: mcp.command,
		kind: "stdio" as const,
		detail: [mcp.command, ...(mcp.args ?? [])].filter(Boolean).join(" "),
		origin: "config" as const,
		removable: false,
	}));
	return [...user, ...config];
}
