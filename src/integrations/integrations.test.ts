import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMcpCatalog, integrationLogoUrl, listedMcpCatalog, MCP_CATALOG } from "./catalog.ts";
import { connectMcp, FIGMA_DESKTOP_DOWN, FIGMA_DESKTOP_MCP } from "./connect.ts";
import { missingProviderClientMessage, writeProviderOAuth } from "./oauth-clients.ts";
import { namespaceRemoteTool } from "./remote-mcp.ts";
import {
	listPublicIntegrations,
	listStoredConnections,
	removeConnection,
	upsertConnection,
} from "./store.ts";

describe("MCP catalog", () => {
	test("lists hosted Linear, Notion, and Figma with MCP URLs", () => {
		expect(findMcpCatalog("linear")?.mcpUrl).toBe("https://mcp.linear.app/mcp");
		expect(findMcpCatalog("notion")?.mcpUrl).toBe("https://mcp.notion.com/mcp");
		expect(findMcpCatalog("figma")?.mcpUrl).toBe("https://mcp.figma.com/mcp");
		expect(MCP_CATALOG.length).toBeGreaterThan(10);
	});

	test("namespaces remote tools", () => {
		expect(namespaceRemoteTool("sanity-mcp", "query.documents")).toBe(
			"sanity_mcp__query_documents",
		);
	});

	test("uses local brand-colored marks, not a text-color mask", () => {
		expect(integrationLogoUrl("canva")).toStartWith("data:image/jpeg");
		expect(integrationLogoUrl("neon-mcp")).toContain("34D59A");
		expect(integrationLogoUrl("linear")).toStartWith("data:image/svg+xml");
		expect(integrationLogoUrl("google-sheets")).toStartWith("data:image/svg+xml");
		expect(integrationLogoUrl("monday")).toStartWith("data:image/png");
		expect(integrationLogoUrl("mux-mcp")).toStartWith("data:image/png");
		expect(integrationLogoUrl("microsoft-365")).toContain("F25022");
		for (const item of MCP_CATALOG) {
			expect(integrationLogoUrl(item.id)).toStartWith("data:");
		}
	});

	test("lists Figma desktop MCP before Google and Microsoft OAuth", () => {
		expect(findMcpCatalog("figma")?.auth).toBe("desktop");
		expect(findMcpCatalog("google-sheets")?.mcpUrl).toBe("https://sheetsmcp.googleapis.com/mcp/v1");
		expect(findMcpCatalog("google-sheets")?.auth).toBe("google");
		expect(findMcpCatalog("microsoft-365")?.mcpUrl).toBe(
			"https://mcp.svc.cloud.microsoft/enterprise",
		);
		expect(findMcpCatalog("microsoft-365")?.auth).toBe("microsoft");
		const ids = listedMcpCatalog().map((item) => item.id);
		const setup = ids.filter((id) => id.startsWith("google-") || id === "microsoft-365");
		expect(setup.length).toBeGreaterThan(1);
		expect(ids.slice(-setup.length)).toEqual(setup);
		expect(ids.indexOf("figma")).toBeLessThan(ids.indexOf("google-sheets"));
		expect(listPublicIntegrations().find((item) => item.id === "figma")?.auth).toBe("desktop");
		expect(listPublicIntegrations().find((item) => item.id === "google-sheets")?.auth).toBe(
			"google",
		);
		expect(listPublicIntegrations().find((item) => item.id === "linear")?.auth).toBeUndefined();
	});
});

describe("integration store", () => {
	test("round-trips a connection without leaking it into the public list tokens", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-int-"));
		const prev = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		try {
			upsertConnection({
				id: "linear",
				label: "Linear",
				mcpUrl: "https://mcp.linear.app/mcp",
				accessToken: "lin_secret_token",
				connectedAt: "2026-01-01T00:00:00.000Z",
			});
			const stored = listStoredConnections();
			expect(stored).toHaveLength(1);
			expect(stored[0]?.accessToken).toBe("lin_secret_token");
			const listed = listPublicIntegrations();
			const linear = listed.find((item) => item.id === "linear");
			expect(linear?.connected).toBe(true);
			expect(JSON.stringify(listed)).not.toContain("lin_secret_token");
			expect(removeConnection("linear")).toBe(true);
			expect(listPublicIntegrations().find((item) => item.id === "linear")?.connected).toBe(false);
		} finally {
			if (prev === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prev;
			await rm(home, { recursive: true, force: true });
		}
	});
});

describe("one-click MCP connect", () => {
	test("discovers, registers, exchanges, and stores Linear", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-oauth-"));
		const prev = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		const opened: string[] = [];
		try {
			const row = await connectMcp({
				connectorId: "linear",
				redirectUri: "http://127.0.0.1:9/oauth/callback",
				openUrl: (url) => opened.push(url),
				waitForCallback: async (state) => {
					expect(state.length).toBeGreaterThan(8);
					return { code: "authcode" };
				},
				fetchImpl: (async (input) => {
					const url = String(input);
					if (url === "https://mcp.linear.app/mcp") {
						return new Response("", {
							status: 401,
							headers: {
								"WWW-Authenticate":
									'Bearer realm="Linear", resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource"',
							},
						});
					}
					if (url.endsWith("/.well-known/oauth-protected-resource")) {
						return Response.json({
							resource: "https://mcp.linear.app/mcp",
							authorization_servers: ["https://mcp.linear.app"],
						});
					}
					if (url.endsWith("/.well-known/oauth-authorization-server")) {
						return Response.json({
							issuer: "https://mcp.linear.app",
							authorization_endpoint: "https://mcp.linear.app/authorize",
							token_endpoint: "https://mcp.linear.app/token",
							registration_endpoint: "https://mcp.linear.app/register",
							token_endpoint_auth_methods_supported: ["none"],
							code_challenge_methods_supported: ["S256"],
						});
					}
					if (url === "https://mcp.linear.app/register") {
						return Response.json({ client_id: "cli_linear" });
					}
					if (url === "https://mcp.linear.app/token") {
						return Response.json({ access_token: "lin_live", refresh_token: "lin_refresh" });
					}
					return new Response("missing", { status: 404 });
				}) as typeof fetch,
			});
			expect(row.id).toBe("linear");
			expect(row.accessToken).toBe("lin_live");
			expect(opened[0]).toContain("https://mcp.linear.app/authorize");
			expect(opened[0]).toContain("client_id=cli_linear");
			expect(opened[0]).toContain("code_challenge");
			expect(listPublicIntegrations().find((item) => item.id === "linear")?.connected).toBe(true);
		} finally {
			if (prev === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prev;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("connects Figma through the desktop MCP when it is running", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-figma-"));
		const prev = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		const opened: string[] = [];
		try {
			const row = await connectMcp({
				connectorId: "figma",
				redirectUri: "http://127.0.0.1:9/oauth/callback",
				openUrl: (url) => opened.push(url),
				waitForCallback: async () => ({ code: "unused" }),
				fetchImpl: (async (input) => {
					if (String(input) === FIGMA_DESKTOP_MCP) return Response.json({ ok: true });
					return new Response("missing", { status: 404 });
				}) as typeof fetch,
			});
			expect(row.mcpUrl).toBe(FIGMA_DESKTOP_MCP);
			expect(opened).toEqual([]);
			expect(listPublicIntegrations().find((item) => item.id === "figma")?.connected).toBe(true);
		} finally {
			if (prev === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prev;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("explains when the Figma desktop MCP is down", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-figma-down-"));
		const prev = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		try {
			await expect(
				connectMcp({
					connectorId: "figma",
					redirectUri: "http://127.0.0.1:9/oauth/callback",
					openUrl: () => {
						throw new Error("Figma must not open a browser OAuth loop.");
					},
					waitForCallback: async () => ({ code: "unused" }),
					fetchImpl: (async (input) => {
						const url = String(input);
						if (url === FIGMA_DESKTOP_MCP) return new Response("", { status: 404 });
						throw new Error(`unexpected fetch ${url}`);
					}) as typeof fetch,
				}),
			).rejects.toThrow(FIGMA_DESKTOP_DOWN);
		} finally {
			if (prev === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prev;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("Google Sheets Connect asks for a Desktop client id when none is stored", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-google-none-"));
		const prev = process.env.HARNESS_HOME;
		const prevId = process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID;
		const prevOauthId = process.env.GOOGLE_OAUTH_CLIENT_ID;
		const prevGoogleId = process.env.GOOGLE_CLIENT_ID;
		process.env.HARNESS_HOME = home;
		delete process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID;
		delete process.env.GOOGLE_OAUTH_CLIENT_ID;
		delete process.env.GOOGLE_CLIENT_ID;
		try {
			await expect(
				connectMcp({
					connectorId: "google-sheets",
					redirectUri: "http://127.0.0.1:9/oauth/callback",
					openUrl: () => undefined,
					waitForCallback: async () => ({ code: "unused" }),
					fetchImpl: (async () =>
						new Response("missing", { status: 404 })) as unknown as typeof fetch,
				}),
			).rejects.toThrow(missingProviderClientMessage("google"));
		} finally {
			if (prev === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prev;
			if (prevId === undefined) delete process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID;
			else process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID = prevId;
			if (prevOauthId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
			else process.env.GOOGLE_OAUTH_CLIENT_ID = prevOauthId;
			if (prevGoogleId === undefined) delete process.env.GOOGLE_CLIENT_ID;
			else process.env.GOOGLE_CLIENT_ID = prevGoogleId;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("connects Google Sheets with a Settings Desktop client id", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-google-settings-"));
		const prev = process.env.HARNESS_HOME;
		const prevId = process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID;
		const prevOauthId = process.env.GOOGLE_OAUTH_CLIENT_ID;
		const prevGoogleId = process.env.GOOGLE_CLIENT_ID;
		process.env.HARNESS_HOME = home;
		delete process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID;
		delete process.env.GOOGLE_OAUTH_CLIENT_ID;
		delete process.env.GOOGLE_CLIENT_ID;
		const opened: string[] = [];
		try {
			writeProviderOAuth("google", { clientId: "user.apps.googleusercontent.com" });
			const row = await connectMcp({
				connectorId: "google-sheets",
				redirectUri: "http://127.0.0.1:9/oauth/callback",
				openUrl: (url) => opened.push(url),
				waitForCallback: async () => ({ code: "authcode" }),
				fetchImpl: (async (input) => {
					const url = String(input);
					if (url === "https://oauth2.googleapis.com/token") {
						return Response.json({ access_token: "ya29.sheets", refresh_token: "1//refresh" });
					}
					return new Response("missing", { status: 404 });
				}) as typeof fetch,
			});
			expect(row.id).toBe("google-sheets");
			expect(row.accessToken).toBe("ya29.sheets");
			expect(opened[0]).toContain("client_id=user.apps.googleusercontent.com");
			expect(opened[0]).not.toContain("resource=");
		} finally {
			if (prev === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prev;
			if (prevId === undefined) delete process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID;
			else process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID = prevId;
			if (prevOauthId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
			else process.env.GOOGLE_OAUTH_CLIENT_ID = prevOauthId;
			if (prevGoogleId === undefined) delete process.env.GOOGLE_CLIENT_ID;
			else process.env.GOOGLE_CLIENT_ID = prevGoogleId;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("connects Google Sheets with a branded env OAuth client", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-google-"));
		const prev = process.env.HARNESS_HOME;
		const prevId = process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID;
		process.env.HARNESS_HOME = home;
		process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID = "caelence.apps.googleusercontent.com";
		const opened: string[] = [];
		try {
			const row = await connectMcp({
				connectorId: "google-sheets",
				redirectUri: "http://127.0.0.1:9/oauth/callback",
				openUrl: (url) => opened.push(url),
				waitForCallback: async () => ({ code: "authcode" }),
				fetchImpl: (async (input) => {
					const url = String(input);
					if (url === "https://oauth2.googleapis.com/token") {
						return Response.json({ access_token: "ya29.sheets", refresh_token: "1//refresh" });
					}
					return new Response("missing", { status: 404 });
				}) as typeof fetch,
			});
			expect(row.id).toBe("google-sheets");
			expect(row.accessToken).toBe("ya29.sheets");
			expect(opened[0]).toContain("https://accounts.google.com/o/oauth2/v2/auth");
			expect(opened[0]).toContain("client_id=caelence.apps.googleusercontent.com");
			expect(opened[0]).toContain("access_type=offline");
			expect(opened[0]).not.toContain("resource=");
			expect(listPublicIntegrations().find((item) => item.id === "google-sheets")?.connected).toBe(
				true,
			);
			expect(listPublicIntegrations().find((item) => item.id === "google-sheets")?.logoKind).toBe(
				"image",
			);
		} finally {
			if (prev === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prev;
			if (prevId === undefined) delete process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID;
			else process.env.CAELENCE_GOOGLE_OAUTH_CLIENT_ID = prevId;
			await rm(home, { recursive: true, force: true });
		}
	});
});
