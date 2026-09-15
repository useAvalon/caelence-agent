/**
 * Remote MCP OAuth 2.1: protected-resource discovery, authorization-server
 * metadata, and dynamic client registration (RFC 9728 / 8414 / 7591).
 */

export interface ProtectedResourceMetadata {
	resource: string;
	authorization_servers?: string[];
}

export interface AuthorizationServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
	code_challenge_methods_supported?: string[];
	token_endpoint_auth_methods_supported?: string[];
}

export interface DynamicClientRegistration {
	clientId: string;
	clientSecret: string;
	tokenAuth: "none" | "body" | "basic";
}

export interface DiscoveredMcpAuth {
	resource: string;
	authorizeUrl: string;
	tokenUrl: string;
	registrationUrl?: string;
	tokenAuth: "none" | "body" | "basic";
	client: DynamicClientRegistration;
}

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

export function canonicalResourceUri(mcpUrl: string): string {
	const url = new URL(mcpUrl);
	url.hash = "";
	url.search = "";
	const path = url.pathname.replace(/\/+$/, "");
	url.pathname = path === "/" ? "" : path;
	return url.toString().replace(/\/+$/, "");
}

export function parseResourceMetadataUrl(header: string): string | undefined {
	const quoted = /resource_metadata\s*=\s*"([^"]+)"/i.exec(header);
	if (quoted?.[1]) return quoted[1];
	const bare = /resource_metadata\s*=\s*([^\s,]+)/i.exec(header);
	return bare?.[1];
}

export function protectedResourceMetadataUrls(mcpUrl: string): string[] {
	const url = new URL(mcpUrl);
	const path = url.pathname.replace(/\/+$/, "");
	const origin = url.origin;
	const urls = [`${origin}/.well-known/oauth-protected-resource`];
	if (path && path !== "/") {
		urls.unshift(`${origin}/.well-known/oauth-protected-resource${path}`);
	}
	return urls;
}

export function authorizationServerMetadataUrls(issuer: string): string[] {
	const url = new URL(issuer);
	const path = url.pathname.replace(/\/+$/, "");
	if (!path || path === "/") {
		return [`${url.origin}/.well-known/oauth-authorization-server`];
	}
	return [
		`${url.origin}/.well-known/oauth-authorization-server${path}`,
		`${issuer.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`,
	];
}

export function registrationAuthMethod(
	methods: readonly string[] | undefined,
): "none" | "client_secret_post" | "client_secret_basic" {
	const set = new Set((methods ?? []).map((m) => m.toLowerCase()));
	if (set.has("none") || set.size === 0) return "none";
	if (set.has("client_secret_post")) return "client_secret_post";
	return "client_secret_basic";
}

export function pickTokenAuth(
	methods: readonly string[] | undefined,
	hasSecret: boolean,
): "none" | "body" | "basic" {
	const set = new Set((methods ?? []).map((m) => m.toLowerCase()));
	if (hasSecret && set.has("client_secret_basic")) return "basic";
	if (hasSecret && (set.has("client_secret_post") || set.size === 0)) return "body";
	if (set.has("none") || set.size === 0) return "none";
	return hasSecret ? "body" : "none";
}

export async function discoverMcpAuth(input: {
	mcpUrl: string;
	redirectUri: string;
	clientName?: string;
	client?: { clientId: string; clientSecret: string };
	fetchImpl?: typeof fetch;
}): Promise<DiscoveredMcpAuth> {
	const fetchImpl = input.fetchImpl ?? globalThis.fetch;
	const resourceMeta = await loadProtectedResourceMetadata(input.mcpUrl, fetchImpl);
	const resource = resourceMeta.resource?.trim() || canonicalResourceUri(input.mcpUrl);
	const issuer = resourceMeta.authorization_servers?.[0]?.trim() || new URL(input.mcpUrl).origin;
	const asMeta = await loadAuthorizationServerMetadata(issuer, fetchImpl);
	if (!asMeta.authorization_endpoint || !asMeta.token_endpoint) {
		throw new Error("Authorization server did not advertise authorize and token endpoints.");
	}
	const stored = input.client?.clientId.trim()
		? { clientId: input.client.clientId.trim(), clientSecret: input.client.clientSecret.trim() }
		: undefined;
	if (stored) {
		const tokenAuth = pickTokenAuth(
			asMeta.token_endpoint_auth_methods_supported,
			Boolean(stored.clientSecret),
		);
		return {
			resource,
			authorizeUrl: asMeta.authorization_endpoint,
			tokenUrl: asMeta.token_endpoint,
			registrationUrl: asMeta.registration_endpoint?.trim(),
			tokenAuth,
			client: { ...stored, tokenAuth },
		};
	}
	const registrationUrl = asMeta.registration_endpoint?.trim();
	if (!registrationUrl) {
		throw new Error("This MCP does not support dynamic client registration.");
	}
	const registered = await registerMcpClient({
		registrationUrl,
		redirectUri: input.redirectUri,
		clientName: input.clientName ?? "Caelence agent",
		tokenEndpointAuthMethod: registrationAuthMethod(asMeta.token_endpoint_auth_methods_supported),
		fetchImpl,
	});
	const tokenAuth = pickTokenAuth(
		asMeta.token_endpoint_auth_methods_supported,
		Boolean(registered.clientSecret),
	);
	return {
		resource,
		authorizeUrl: asMeta.authorization_endpoint,
		tokenUrl: asMeta.token_endpoint,
		registrationUrl,
		tokenAuth,
		client: { ...registered, tokenAuth },
	};
}

async function loadProtectedResourceMetadata(
	mcpUrl: string,
	fetchImpl: typeof fetch,
): Promise<ProtectedResourceMetadata> {
	const headerUrl = await probeResourceMetadataUrl(mcpUrl, fetchImpl);
	const candidates = headerUrl
		? [headerUrl, ...protectedResourceMetadataUrls(mcpUrl)]
		: protectedResourceMetadataUrls(mcpUrl);
	const seen = new Set<string>();
	for (const url of candidates) {
		if (seen.has(url)) continue;
		seen.add(url);
		const json = await getJson(url, fetchImpl);
		if (!json) continue;
		const resource = typeof json.resource === "string" ? json.resource : "";
		if (!resource) continue;
		const servers = Array.isArray(json.authorization_servers)
			? json.authorization_servers.filter(
					(s): s is string => typeof s === "string" && s.trim() !== "",
				)
			: [];
		return { resource, authorization_servers: servers };
	}
	const origin = new URL(mcpUrl).origin;
	const asMeta = await loadAuthorizationServerMetadata(origin, fetchImpl).catch(() => null);
	if (asMeta?.authorization_endpoint && asMeta?.token_endpoint) {
		return { resource: canonicalResourceUri(mcpUrl), authorization_servers: [origin] };
	}
	throw new Error("Could not discover OAuth metadata for this MCP.");
}

async function probeResourceMetadataUrl(
	mcpUrl: string,
	fetchImpl: typeof fetch,
): Promise<string | undefined> {
	try {
		const res = await fetchImpl(mcpUrl, {
			method: "POST",
			headers: {
				Accept: "application/json, text/event-stream",
				"Content-Type": "application/json",
				"MCP-Protocol-Version": "2025-06-18",
			},
			body: INIT_BODY,
			signal: AbortSignal.timeout(4000),
		});
		if (res.status !== 401) return undefined;
		return parseResourceMetadataUrl(res.headers.get("www-authenticate") ?? "");
	} catch {
		return undefined;
	}
}

async function loadAuthorizationServerMetadata(
	issuer: string,
	fetchImpl: typeof fetch,
): Promise<AuthorizationServerMetadata> {
	for (const url of authorizationServerMetadataUrls(issuer)) {
		const json = await getJson(url, fetchImpl);
		if (!json) continue;
		const authorization_endpoint =
			typeof json.authorization_endpoint === "string" ? json.authorization_endpoint : "";
		const token_endpoint = typeof json.token_endpoint === "string" ? json.token_endpoint : "";
		if (!authorization_endpoint || !token_endpoint) continue;
		return {
			issuer: typeof json.issuer === "string" ? json.issuer : issuer,
			authorization_endpoint,
			token_endpoint,
			registration_endpoint:
				typeof json.registration_endpoint === "string" ? json.registration_endpoint : undefined,
			code_challenge_methods_supported: stringList(json.code_challenge_methods_supported),
			token_endpoint_auth_methods_supported: stringList(json.token_endpoint_auth_methods_supported),
		};
	}
	throw new Error("Could not load authorization server metadata.");
}

export function isLoopbackRedirect(uri: string): boolean {
	try {
		const host = new URL(uri).hostname;
		return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
	} catch {
		return false;
	}
}

export async function registerMcpClient(input: {
	registrationUrl: string;
	redirectUri: string;
	clientName: string;
	tokenEndpointAuthMethod?: "none" | "client_secret_post" | "client_secret_basic";
	fetchImpl: typeof fetch;
}): Promise<DynamicClientRegistration> {
	const tokenEndpointAuthMethod = input.tokenEndpointAuthMethod ?? "none";
	const preferred: "native" | "web" = isLoopbackRedirect(input.redirectUri) ? "native" : "web";
	const attempts: Array<"native" | "web"> =
		preferred === "native" ? ["native", "web"] : ["web", "native"];
	let lastStatus = 0;
	let lastBody = "";
	for (const applicationType of attempts) {
		const res = await input.fetchImpl(input.registrationUrl, {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: JSON.stringify({
				client_name: input.clientName,
				redirect_uris: [input.redirectUri],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: tokenEndpointAuthMethod,
				application_type: applicationType,
			}),
		});
		const raw = await res.text();
		if (res.ok) return parseRegistration(raw);
		lastStatus = res.status;
		lastBody = raw;
		if (res.status !== 400 && res.status !== 403) break;
	}
	throw new Error(registrationError(input.registrationUrl, lastStatus, lastBody));
}

function parseRegistration(raw: string): DynamicClientRegistration {
	let json: { client_id?: string; client_secret?: string };
	try {
		json = JSON.parse(raw) as { client_id?: string; client_secret?: string };
	} catch {
		throw new Error("Client registration returned a non-JSON body.");
	}
	const clientId = json.client_id?.trim() ?? "";
	if (!clientId) throw new Error("Authorization server did not return a client id.");
	const clientSecret = json.client_secret?.trim() ?? "";
	return {
		clientId,
		clientSecret,
		tokenAuth: clientSecret ? "body" : "none",
	};
}

function registrationError(registrationUrl: string, status: number, raw: string): string {
	const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 160);
	if (/figma\.com/i.test(registrationUrl) && status === 403) {
		return "Figma blocked client registration (403). Remote MCP only allows approved clients. Open Figma desktop, enable the Dev Mode MCP server, then Connect again.";
	}
	return snippet
		? `Client registration failed (${status}): ${snippet}`
		: `Client registration failed (${status})`;
}

async function getJson(
	url: string,
	fetchImpl: typeof fetch,
): Promise<Record<string, unknown> | null> {
	try {
		const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
		if (!res.ok) return null;
		const json: unknown = await res.json();
		return json && typeof json === "object" && !Array.isArray(json)
			? (json as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out = value.filter((item): item is string => typeof item === "string");
	return out.length > 0 ? out : undefined;
}
