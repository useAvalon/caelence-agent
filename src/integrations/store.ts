import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { harnessHome } from "../desktop/secrets.ts";
import {
	type IntegrationLogoKind,
	integrationLogoKind,
	integrationLogoUrl,
	listedMcpCatalog,
	type McpAuthKind,
	type McpCatalogEntry,
} from "./catalog.ts";
import type { LinkedMcpSource } from "./remote-mcp.ts";

export interface StoredMcpConnection {
	id: string;
	label: string;
	mcpUrl: string;
	accessToken: string;
	refreshToken?: string;
	connectedAt: string;
}

export interface PublicIntegration {
	id: string;
	label: string;
	description: string;
	docsUrl: string;
	logoUrl: string;
	logoKind: IntegrationLogoKind;
	glyph: string;
	connected: boolean;
	auth?: McpAuthKind;
}

interface StoreFile {
	connections: StoredMcpConnection[];
}

export function integrationsPath(env: Record<string, string | undefined> = process.env): string {
	return resolve(harnessHome(env), "integrations.json");
}

function readStore(env: Record<string, string | undefined> = process.env): StoreFile {
	const path = integrationsPath(env);
	if (!existsSync(path)) return { connections: [] };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as StoreFile;
		if (!parsed || !Array.isArray(parsed.connections)) return { connections: [] };
		return { connections: parsed.connections.filter(isStoredConnection) };
	} catch {
		return { connections: [] };
	}
}

function isStoredConnection(value: unknown): value is StoredMcpConnection {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row.id === "string" &&
		typeof row.label === "string" &&
		typeof row.mcpUrl === "string" &&
		typeof row.accessToken === "string" &&
		typeof row.connectedAt === "string"
	);
}

function writeStore(store: StoreFile, env: Record<string, string | undefined> = process.env): void {
	const path = integrationsPath(env);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(store, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		// best-effort on filesystems that ignore mode
	}
}

export function listStoredConnections(
	env: Record<string, string | undefined> = process.env,
): StoredMcpConnection[] {
	return readStore(env).connections;
}

export function listPublicIntegrations(
	env: Record<string, string | undefined> = process.env,
): PublicIntegration[] {
	const connected = new Set(listStoredConnections(env).map((row) => row.id));
	return listedMcpCatalog().map((item) => toPublic(item, connected.has(item.id)));
}

export function linkedMcpSources(
	env: Record<string, string | undefined> = process.env,
): LinkedMcpSource[] {
	return listStoredConnections(env).map((row) => ({
		connectorId: row.id,
		label: row.label,
		mcpUrl: row.mcpUrl,
		accessToken: row.accessToken,
	}));
}

export function upsertConnection(
	row: StoredMcpConnection,
	env: Record<string, string | undefined> = process.env,
): void {
	const store = readStore(env);
	store.connections = store.connections.filter((item) => item.id !== row.id);
	store.connections.push(row);
	writeStore(store, env);
}

export function removeConnection(
	id: string,
	env: Record<string, string | undefined> = process.env,
): boolean {
	const store = readStore(env);
	const next = store.connections.filter((item) => item.id !== id);
	if (next.length === store.connections.length) return false;
	writeStore({ connections: next }, env);
	return true;
}

export function connectionFromCatalog(
	entry: McpCatalogEntry,
	tokens: { accessToken: string; refreshToken?: string },
): StoredMcpConnection {
	return {
		id: entry.id,
		label: entry.label,
		mcpUrl: entry.mcpUrl,
		accessToken: tokens.accessToken,
		...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
		connectedAt: new Date().toISOString(),
	};
}

function toPublic(item: McpCatalogEntry, connected: boolean): PublicIntegration {
	return {
		id: item.id,
		label: item.label,
		description: item.description,
		docsUrl: item.docsUrl,
		logoUrl: integrationLogoUrl(item.id),
		logoKind: integrationLogoKind(item.id),
		glyph: item.glyph,
		connected,
		...(item.auth ? { auth: item.auth } : {}),
	};
}
