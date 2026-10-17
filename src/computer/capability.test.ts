import { describe, expect, test } from "bun:test";
import {
	argumentsForCreate,
	type CatalogHints,
	catalogFailureSummary,
	catalogPageBody,
	createdPageUrl,
	decideCatalog,
	isolatedName,
	pageTitle,
	pickCreateTool,
	readWebMcpTools,
} from "./capability.ts";

const notion: CatalogHints = {
	id: "notion",
	label: "Notion",
	aliases: ["notion"],
	domains: ["notion.com"],
	macAppNames: ["Notion"],
};

const linear: CatalogHints = {
	id: "linear",
	label: "Linear",
	aliases: ["linear"],
	domains: ["linear.app"],
	macAppNames: ["Linear"],
};

describe("catalog match", () => {
	test("notion.so plus a new page matches Notion", () => {
		const match = decideCatalog({
			task: "write a new page about the launch",
			host: "www.notion.so",
			entries: [notion, linear],
			connectedIds: new Set(),
			declinedIds: new Set(),
		});
		expect(match?.id).toBe("notion");
		expect(match?.exact).toBe(true);
	});

	test("a follow-up that names Notion matches Notion, not the earlier site", () => {
		const match = decideCatalog({
			task: "summarize top news on current tab and post on x\ndo it in notion instead",
			host: "https://notion.com/",
			askedHost: "https://notion.com/",
			entries: [notion, linear],
			connectedIds: new Set(["notion"]),
			declinedIds: new Set(),
		});
		expect(match?.id).toBe("notion");
		expect(match?.connected).toBe(true);
	});

	test("a named app wins over the tab already open", () => {
		const cloudflare: CatalogHints = {
			id: "cloudflare-mcp",
			label: "Cloudflare",
			aliases: ["cloudflare"],
			domains: ["cloudflare.com"],
			macAppNames: ["Cloudflare"],
		};
		const match = decideCatalog({
			task: "open notion and write about webmcp",
			host: "https://blog.cloudflare.com/something",
			entries: [cloudflare, notion],
			connectedIds: new Set(),
			declinedIds: new Set(),
		});
		expect(match?.id).toBe("notion");
	});

	test("go to linkedin does not offer the cloudflare tab", () => {
		const cloudflare: CatalogHints = {
			id: "cloudflare-mcp",
			label: "Cloudflare",
			aliases: ["cloudflare"],
			domains: ["cloudflare.com"],
			macAppNames: ["Cloudflare"],
		};
		expect(
			decideCatalog({
				task: "go to linkedin and write a post about current tab",
				host: "https://blog.cloudflare.com/webmcp",
				askedHost: "https://linkedin.com/",
				entries: [cloudflare, notion],
				connectedIds: new Set(),
				declinedIds: new Set(),
			}),
		).toBeUndefined();
	});

	test("linear regression is not Linear", () => {
		expect(isolatedName("do it in notion instead", "Notion")).toBe(true);
		expect(isolatedName("explain linear regression", "Linear")).toBe(false);
		expect(
			decideCatalog({
				task: "explain linear regression",
				entries: [linear],
				connectedIds: new Set(),
				declinedIds: new Set(),
			}),
		).toBeUndefined();
	});
});

describe("connected create tool", () => {
	test("picks a create-page tool and skips search", () => {
		const tool = pickCreateTool([
			{ name: "notion-search", description: "Search pages" },
			{ name: "notion-fetch", description: "Fetch a page" },
			{ name: "notion-create-pages", description: "Create pages" },
		]);
		expect(tool?.name).toBe("notion-create-pages");
	});

	test("sends the body in the pages array the schema asks for", () => {
		expect(
			argumentsForCreate(
				{ properties: { pages: { type: "array" }, parent: { type: "object" } } },
				"From the blog",
				"WebMCP lets a site register tools.",
			),
		).toEqual({
			pages: [
				{
					properties: { title: "From the blog" },
					content: "WebMCP lets a site register tools.",
				},
			],
		});
	});
});

test("reads the new page address from the tool result", () => {
	expect(createdPageUrl('Created {"url":"https://www.notion.so/WebMCP-abc123"}')).toBe(
		"https://www.notion.so/WebMCP-abc123",
	);
});

test("does not save the user's ask as the page", () => {
	const ask = "analyze 10 news in current tab and write a page about it in notion";
	expect(catalogPageBody(ask, ask)).toBeUndefined();
	expect(catalogPageBody(ask, "EMPTY")).toBeUndefined();
	expect(catalogPageBody(ask, "")).toBeUndefined();
	expect(catalogPageBody(ask, `# it in notion\n\n${ask}`)).toBeUndefined();
	expect(
		catalogPageBody(ask, "## Ten headlines\n\n1. Markets opened higher after the Fed held rates."),
	).toContain("Markets opened");
	expect(
		catalogPageBody(
			ask,
			`${ask}\n\n## Ten headlines\n\n1. Markets opened higher after the Fed held rates.\n2. A storm hit the Midwest.`,
		),
	).toContain("Markets opened");
	expect(
		catalogPageBody(
			"analyze top 10 news and post on x",
			"Breaking News, Latest News\n\nanalyze top 10 news and post on x",
		),
	).toBeUndefined();
});

test("page title is the heading the draft already wrote", () => {
	expect(
		pageTitle("# Markets after the Fed\n\n1. Rates held overnight.\n2. Storms hit the Midwest."),
	).toBe("Markets after the Fed");
	expect(pageTitle("1. Markets jumped after the Fed held rates overnight")).toBe("");
});

test("stale catalog connections say reconnect instead of stalling", () => {
	expect(catalogFailureSummary("Notion", new Error("MCP HTTP 401: invalid_token"))).toBe(
		"The Notion connection expired. Reconnect it in Settings.",
	);
	expect(catalogFailureSummary("Notion", new Error("The operation was aborted"))).toBe(
		"Notion didn't respond. Reconnect it in Settings if this keeps happening.",
	);
});

describe("webmcp", () => {
	test("reads tools and ignores a page without them", async () => {
		expect(await readWebMcpTools(async () => ["create_page"])).toEqual(["create_page"]);
		expect(await readWebMcpTools(async () => [])).toEqual([]);
		expect(
			await readWebMcpTools(async () => {
				throw new Error("missing");
			}),
		).toEqual([]);
	});
});
