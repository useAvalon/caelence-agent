import { describe, expect, test } from "bun:test";
import { MCP_CATALOG, setLiveCatalog } from "./catalog.ts";
import {
	connectionSetup,
	entriesFromRegistry,
	extractMcpUrl,
	loadCatalogSeed,
	mergeCatalog,
	syncCatalog,
} from "./catalog-sync.ts";

describe("catalog sync", () => {
	test("seed plus mock registry produces verified entries including TradingView", async () => {
		expect(loadCatalogSeed().some((row) => row.name === "TradingView")).toBe(true);
		const registry = {
			servers: [
				{
					name: "Extra",
					remotes: [{ url: "https://mcp.example.com/mcp" }],
					websiteUrl: "https://example.com/docs",
				},
			],
		};
		const fromRegistry = entriesFromRegistry(registry);
		const merged = mergeCatalog(MCP_CATALOG, fromRegistry);
		const trading = merged.find((row) => row.id === "tradingview" || row.label === "TradingView");
		expect(trading?.mcpUrl).toBe("https://mcp.tradingview.com/mcp");
		expect(fromRegistry.some((row) => row.mcpUrl === "https://mcp.example.com/mcp")).toBe(true);

		const fetched = await syncCatalog({
			force: true,
			cacheFile: "/tmp/caelence-catalog-cache-test.json",
			fetchImpl: async (input) => {
				const url = String(input);
				if (url.includes("registry.modelcontextprotocol.io")) {
					return new Response(JSON.stringify(registry), { status: 200 });
				}
				if (url.includes("mcp.tradingview.com") || url.includes("mcp.example.com")) {
					return new Response("", {
						status: 401,
						headers: {
							"WWW-Authenticate":
								'Bearer FAKESECRET_g3h4i5j6k7l8m9n0o1p2="https://example.com/.well-known/oauth-protected-resource"',
						},
					});
				}
				return new Response("MCP at https://mcp.tradingview.com/mcp", { status: 200 });
			},
		});
		expect(fetched.find((row) => row.label === "TradingView")?.mcpUrl).toBe(
			"https://mcp.tradingview.com/mcp",
		);
		expect(extractMcpUrl("see https://mcp.tradingview.com/mcp for oauth")).toBe(
			"https://mcp.tradingview.com/mcp",
		);
		setLiveCatalog(undefined);
	});

	test("only Google and Microsoft need extra OAuth-client setup", () => {
		expect(connectionSetup({ connected: false, authProbe: "oauth_preregistered" })).toBe("dcr");
		expect(
			connectionSetup({
				connected: false,
				auth: "oauth_preregistered",
				authProbe: "oauth_preregistered",
			}),
		).toBe("dcr");
		expect(connectionSetup({ connected: false, auth: "google" })).toBe("needs_setup");
		expect(connectionSetup({ connected: false, auth: "microsoft" })).toBe("needs_setup");
		expect(connectionSetup({ connected: true, auth: "google" })).toBe("connected");
	});
});
