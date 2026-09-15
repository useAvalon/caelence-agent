/** PKCE + authorize URL + token exchange. */

export interface OAuthSpec {
	authorizeUrl: string;
	tokenUrl: string;
	tokenAuth?: "body" | "basic" | "none";
	tokenBody?: "form" | "json";
	pkce?: boolean;
	extraAuthParams?: Record<string, string>;
}

export interface OAuthClient {
	clientId: string;
	clientSecret: string;
}

export function usesPkce(spec: OAuthSpec): boolean {
	return spec.pkce !== false;
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const verifier = b64url(bytes);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

export function b64url(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function buildAuthorizeUrl(input: {
	spec: OAuthSpec;
	clientId: string;
	redirectUri: string;
	state: string;
	scopes: readonly string[];
	challenge: string;
	resource?: string;
}): string {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: input.clientId,
		redirect_uri: input.redirectUri,
		state: input.state,
		...(input.spec.extraAuthParams ?? {}),
	});
	if (input.scopes.length > 0) params.set("scope", input.scopes.join(" "));
	if (input.resource) params.set("resource", input.resource);
	if (usesPkce(input.spec)) {
		params.set("code_challenge", input.challenge);
		params.set("code_challenge_method", "S256");
	}
	const join = input.spec.authorizeUrl.includes("?") ? "&" : "?";
	return `${input.spec.authorizeUrl}${join}${params}`;
}

export interface TokenExchangeResult {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
	scope?: string;
}

export async function exchangeAuthorizationCode(input: {
	spec: OAuthSpec;
	client: OAuthClient;
	code: string;
	redirectUri: string;
	verifier: string;
	resource?: string;
	fetchImpl?: typeof fetch;
}): Promise<TokenExchangeResult> {
	const fetchImpl = input.fetchImpl ?? globalThis.fetch;
	const tokenAuth = input.spec.tokenAuth ?? (input.client.clientSecret ? "body" : "none");
	const params: Record<string, string> = {
		grant_type: "authorization_code",
		code: input.code,
		redirect_uri: input.redirectUri,
	};
	if (tokenAuth === "body" || tokenAuth === "none") {
		params.client_id = input.client.clientId;
		if (tokenAuth === "body" && input.client.clientSecret) {
			params.client_secret = input.client.clientSecret;
		}
	}
	if (usesPkce(input.spec)) params.code_verifier = input.verifier;
	if (input.resource) params.resource = input.resource;

	const headers: Record<string, string> = { Accept: "application/json" };
	if (tokenAuth === "basic") {
		headers.Authorization = `Basic ${btoa(`${input.client.clientId}:${input.client.clientSecret}`)}`;
	}

	let body: string;
	if (input.spec.tokenBody === "json") {
		headers["Content-Type"] = "application/json";
		body = JSON.stringify(params);
	} else {
		headers["Content-Type"] = "application/x-www-form-urlencoded";
		body = new URLSearchParams(params).toString();
	}

	const res = await fetchImpl(input.spec.tokenUrl, { method: "POST", headers, body });
	const raw = await res.text();
	if (!res.ok) {
		throw new Error(`Token exchange failed (${res.status})`);
	}
	const parsed = parseTokenResponse(raw);
	if (!parsed.access_token) throw new Error("Provider did not return an access token");
	return parsed;
}

export function parseTokenResponse(raw: string): TokenExchangeResult {
	const trimmed = raw.trim();
	if (trimmed.startsWith("{")) {
		const json = JSON.parse(trimmed) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
			token_type?: string;
			scope?: string;
			authed_user?: { access_token?: string };
		};
		const access = json.access_token || json.authed_user?.access_token || "";
		return {
			access_token: access,
			refresh_token: json.refresh_token,
			expires_in: json.expires_in,
			token_type: json.token_type,
			scope: json.scope,
		};
	}
	const form = new URLSearchParams(trimmed);
	return {
		access_token: form.get("access_token") ?? "",
		refresh_token: form.get("refresh_token") ?? undefined,
		expires_in: form.get("expires_in") ? Number(form.get("expires_in")) : undefined,
		token_type: form.get("token_type") ?? undefined,
		scope: form.get("scope") ?? undefined,
	};
}
