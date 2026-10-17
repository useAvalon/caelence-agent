import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PRODUCT_NAME } from "../product.ts";
import { findMcpCatalog, type McpAuthKind, type McpCatalogEntry } from "./catalog.ts";
import { canonicalResourceUri, type DiscoveredMcpAuth, discoverMcpAuth } from "./mcp-oauth.ts";
import {
	buildAuthorizeUrl,
	exchangeAuthorizationCode,
	type OAuthClient,
	type OAuthSpec,
	pkcePair,
} from "./oauth.ts";
import {
	missingProviderClientMessage,
	type ProviderOAuthKind,
	readProviderOAuth,
} from "./oauth-clients.ts";
import { connectionFromCatalog, type StoredMcpConnection, upsertConnection } from "./store.ts";

export const FIGMA_DESKTOP_MCP = "http://127.0.0.1:3845/mcp";
export const FIGMA_DESKTOP_DOWN =
	"Figma desktop MCP is not running at 127.0.0.1:3845. Open Figma desktop, switch to Dev Mode, enable the desktop MCP server, then Connect again.";

const INIT_BODY = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "caelence-agent", version: "0.1" },
	},
});

export interface OAuthCallback {
	code?: string;
	error?: string;
}

export interface ConnectMcpOptions {
	connectorId: string;
	redirectUri: string;
	waitForCallback: (state: string) => Promise<OAuthCallback>;
	openUrl?: (url: string) => void;
	fetchImpl?: typeof fetch;
	now?: () => Date;
}

export function openSystemBrowser(url: string): void {
	if (process.platform === "darwin") {
		spawn("/usr/bin/open", [url], { detached: true, stdio: "ignore" }).unref();
		return;
	}
	if (process.platform === "win32") {
		spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
		return;
	}
	spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

export async function probeMcp(
	mcpUrl: string,
	fetchImpl: typeof fetch = globalThis.fetch,
): Promise<boolean> {
	try {
		const res = await fetchImpl(mcpUrl, {
			method: "POST",
			headers: {
				Accept: "application/json, text/event-stream",
				"Content-Type": "application/json",
				"MCP-Protocol-Version": "2025-06-18",
			},
			body: INIT_BODY,
			signal: AbortSignal.timeout(1500),
		});
		return res.status !== 404 && res.status < 500;
	} catch {
		return false;
	}
}

export async function connectMcp(options: ConnectMcpOptions): Promise<StoredMcpConnection> {
	const entry = findMcpCatalog(options.connectorId);
	if (!entry) throw new Error(`No MCP catalog entry ${options.connectorId}.`);
	if (entry.id === "figma" || entry.auth === "desktop") return connectFigma(options, entry);
	return connectRemote(options, entry);
}

async function connectFigma(
	options: ConnectMcpOptions,
	entry: McpCatalogEntry,
): Promise<StoredMcpConnection> {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	if (await probeMcp(FIGMA_DESKTOP_MCP, fetchImpl)) {
		const row = connectionFromCatalog({ ...entry, mcpUrl: FIGMA_DESKTOP_MCP }, { accessToken: "" });
		if (options.now) row.connectedAt = options.now().toISOString();
		upsertConnection(row);
		return row;
	}
	throw new Error(FIGMA_DESKTOP_DOWN);
}

async function connectRemote(
	options: ConnectMcpOptions,
	entry: McpCatalogEntry,
): Promise<StoredMcpConnection> {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const auth = entry.auth ?? "dcr";
	const stored = providerClient(auth);
	if ((auth === "google" || auth === "microsoft") && !stored) {
		throw new Error(missingProviderClientMessage(auth));
	}
	const discovered = await discoverOrFallback({
		mcpUrl: entry.mcpUrl,
		redirectUri: options.redirectUri,
		clientName: PRODUCT_NAME,
		auth,
		client: stored,
		fetchImpl,
	});
	const spec: OAuthSpec = {
		authorizeUrl: discovered.authorizeUrl,
		tokenUrl: discovered.tokenUrl,
		tokenAuth: discovered.tokenAuth,
		pkce: true,
		extraAuthParams:
			auth === "google"
				? { access_type: "offline", prompt: "consent", include_granted_scopes: "true" }
				: undefined,
	};
	const { verifier, challenge } = await pkcePair();
	const state = randomBytes(16).toString("hex");
	const useResource = auth === "dcr";
	const authorizeUrl = buildAuthorizeUrl({
		spec,
		clientId: discovered.client.clientId,
		redirectUri: options.redirectUri,
		state,
		scopes: entry.scopes,
		challenge,
		resource: useResource ? discovered.resource : undefined,
	});
	(options.openUrl ?? openSystemBrowser)(authorizeUrl);
	const callback = await options.waitForCallback(state);
	if (callback.error || !callback.code) {
		throw new Error(
			callback.error
				? `Sign-in was denied (${callback.error}). Try Connect again.`
				: "Sign-in did not return a code. Try Connect again.",
		);
	}
	const tokens = await exchangeAuthorizationCode({
		spec,
		client: {
			clientId: discovered.client.clientId,
			clientSecret: discovered.client.clientSecret,
		},
		code: callback.code,
		redirectUri: options.redirectUri,
		verifier,
		resource: useResource ? discovered.resource : undefined,
		fetchImpl,
	});
	const row = connectionFromCatalog(entry, {
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
	});
	if (options.now) row.connectedAt = options.now().toISOString();
	upsertConnection(row);
	return row;
}

function providerClient(auth: McpAuthKind): OAuthClient | undefined {
	if (auth !== "google" && auth !== "microsoft") return undefined;
	return readProviderOAuth(auth);
}

async function discoverOrFallback(input: {
	mcpUrl: string;
	redirectUri: string;
	clientName: string;
	auth: McpAuthKind;
	client?: OAuthClient;
	fetchImpl: typeof fetch;
}): Promise<DiscoveredMcpAuth> {
	try {
		return await discoverMcpAuth({
			mcpUrl: input.mcpUrl,
			redirectUri: input.redirectUri,
			clientName: input.clientName,
			client: input.client,
			fetchImpl: input.fetchImpl,
		});
	} catch (err) {
		if ((input.auth === "google" || input.auth === "microsoft") && input.client) {
			return staticProviderAuth(input.auth, input.client, input.mcpUrl);
		}
		throw err;
	}
}

function staticProviderAuth(
	kind: ProviderOAuthKind,
	client: OAuthClient,
	mcpUrl: string,
): DiscoveredMcpAuth {
	const tokenAuth = client.clientSecret ? "body" : "none";
	const endpoints =
		kind === "google"
			? {
					authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
					tokenUrl: "https://oauth2.googleapis.com/token",
				}
			: {
					authorizeUrl: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
					tokenUrl: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
				};
	return {
		resource: canonicalResourceUri(mcpUrl),
		authorizeUrl: endpoints.authorizeUrl,
		tokenUrl: endpoints.tokenUrl,
		tokenAuth,
		client: { clientId: client.clientId, clientSecret: client.clientSecret, tokenAuth },
	};
}

export function oauthResultPage(ok: boolean, detail: string): string {
	const title = ok ? "Connected" : "Sign-in did not finish";
	const escaped = detail.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${escaped}</p></body></html>`;
}
