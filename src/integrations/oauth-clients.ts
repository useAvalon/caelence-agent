import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { harnessHome } from "../desktop/secrets.ts";

export type ProviderOAuthKind = "google" | "microsoft";

export interface ProviderOAuthClient {
	clientId: string;
	clientSecret: string;
}

interface StoreFile {
	google?: ProviderOAuthClient;
	microsoft?: ProviderOAuthClient;
}

/**
 * Optional distributor Google OAuth client (Desktop app, PKCE, loopback).
 * Official Caelence builds may set CAELENCE_GOOGLE_OAUTH_CLIENT_ID. Open-source
 * builds leave this empty; each user pastes their own Desktop client id in Settings.
 */
export const BUNDLED_GOOGLE_OAUTH_CLIENT_ID = "";

const GOOGLE_ID_ENV = [
	"CAELENCE_GOOGLE_OAUTH_CLIENT_ID",
	"GOOGLE_OAUTH_CLIENT_ID",
	"GOOGLE_CLIENT_ID",
] as const;

const GOOGLE_SECRET_ENV = [
	"CAELENCE_GOOGLE_OAUTH_CLIENT_SECRET",
	"GOOGLE_OAUTH_CLIENT_SECRET",
	"GOOGLE_CLIENT_SECRET",
] as const;

const ENV_KEYS: Record<ProviderOAuthKind, { id: string; secret: string }> = {
	google: { id: "GOOGLE_OAUTH_CLIENT_ID", secret: "GOOGLE_OAUTH_CLIENT_SECRET" },
	microsoft: { id: "MICROSOFT_OAUTH_CLIENT_ID", secret: "MICROSOFT_OAUTH_CLIENT_SECRET" },
};

export function oauthClientsPath(env: Record<string, string | undefined> = process.env): string {
	return resolve(harnessHome(env), "oauth-clients.json");
}

function readStore(env: Record<string, string | undefined> = process.env): StoreFile {
	const path = oauthClientsPath(env);
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as StoreFile;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writeStore(store: StoreFile, env: Record<string, string | undefined> = process.env): void {
	const path = oauthClientsPath(env);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(store, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		// best-effort on filesystems that ignore mode
	}
}

function fromPair(
	id: string | undefined,
	secret: string | undefined,
): ProviderOAuthClient | undefined {
	const clientId = id?.trim() ?? "";
	if (!clientId) return undefined;
	return { clientId, clientSecret: secret?.trim() ?? "" };
}

function firstEnv(keys: readonly string[], env: Record<string, string | undefined>): string {
	for (const key of keys) {
		const value = env[key]?.trim();
		if (value) return value;
	}
	return "";
}

export function readProviderOAuth(
	kind: ProviderOAuthKind,
	env: Record<string, string | undefined> = process.env,
): ProviderOAuthClient | undefined {
	if (kind === "google") {
		const fromEnv = fromPair(firstEnv(GOOGLE_ID_ENV, env), firstEnv(GOOGLE_SECRET_ENV, env));
		if (fromEnv) return fromEnv;
		const stored = readStore(env).google;
		const fromStore = fromPair(stored?.clientId, stored?.clientSecret);
		if (fromStore) return fromStore;
		return fromPair(BUNDLED_GOOGLE_OAUTH_CLIENT_ID, "");
	}
	const keys = ENV_KEYS[kind];
	const fromEnv = fromPair(env[keys.id], env[keys.secret]);
	if (fromEnv) return fromEnv;
	const stored = readStore(env)[kind];
	return fromPair(stored?.clientId, stored?.clientSecret);
}

export function writeProviderOAuth(
	kind: ProviderOAuthKind,
	patch: { clientId?: string; clientSecret?: string },
	env: Record<string, string | undefined> = process.env,
): void {
	const store = readStore(env);
	const prev = store[kind] ?? { clientId: "", clientSecret: "" };
	const next: ProviderOAuthClient = {
		clientId: patch.clientId?.trim() || prev.clientId,
		clientSecret: patch.clientSecret?.trim() || prev.clientSecret,
	};
	if (!next.clientId && !next.clientSecret) {
		delete store[kind];
	} else {
		store[kind] = next;
	}
	writeStore(store, env);
}

export function missingProviderClientMessage(kind: ProviderOAuthKind): string {
	if (kind === "google") {
		return "Google Workspace MCP has no dynamic client registration. Add a Desktop OAuth client id in Settings, then Connect.";
	}
	return "Microsoft MCP does not support one-click registration. Add an Entra app client id in Settings, then Connect.";
}
