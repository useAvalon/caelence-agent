import { describe, expect, test } from "bun:test";
import type { McpToolDefinition } from "../core/mcp.ts";
import { READ_ONLY_ANNOTATIONS, textResult, UNKNOWN_TOOL_ANNOTATIONS } from "../core/mcp.ts";
import {
	adaptBrowserTools,
	BROWSER_USE_SPEC,
	browserAccess,
	browserServerOptions,
	browserSetupHint,
	mentionsBrowser,
} from "./browser-use.ts";

function tool(name: string, reply = "ok", isError = false): McpToolDefinition {
	return {
		name,
		description: name,
		inputSchema: { type: "object", properties: {} },
		annotations: UNKNOWN_TOOL_ANNOTATIONS,
		async handler() {
			return textResult(reply, isError);
		},
	};
}

describe("mentionsBrowser", () => {
	test("matches @browser as its own word", () => {
		expect(mentionsBrowser("@browser open example.com")).toBe(true);
		expect(mentionsBrowser("please @browser check this")).toBe(true);
		expect(mentionsBrowser("use (@browser) here")).toBe(true);
		expect(mentionsBrowser("@Browser go")).toBe(true);
		expect(mentionsBrowser("ask @browser.")).toBe(true);
	});

	test("ignores look-alikes", () => {
		expect(mentionsBrowser("open the browser")).toBe(false);
		expect(mentionsBrowser("mail me@browser.com")).toBe(false);
		expect(mentionsBrowser("@browsers are great")).toBe(false);
		expect(mentionsBrowser("@browser-use docs")).toBe(false);
		expect(mentionsBrowser("")).toBe(false);
	});
});

describe("browserAccess", () => {
	test("is mention-only unless configured", () => {
		expect(browserAccess(undefined)).toBe("mention");
		expect(browserAccess({})).toBe("mention");
		expect(browserAccess({ headless: true })).toBe("mention");
		expect(browserAccess({ enabled: true })).toBe("always");
		expect(browserAccess({ enabled: false })).toBe("off");
	});
});

describe("browserServerOptions", () => {
	test("pins browser-use and turns telemetry off", () => {
		const opts = browserServerOptions(undefined, "/tmp/x");
		expect(opts.command).toBe("uvx");
		expect(opts.args).toEqual(["--from", BROWSER_USE_SPEC, "browser-use", "--mcp"]);
		expect(opts.env?.ANONYMIZED_TELEMETRY).toBe("false");
		expect(opts.env?.BROWSER_USE_CLOUD_SYNC).toBe("false");
		expect(opts.env).not.toHaveProperty("BROWSER_USE_HEADLESS");
		expect(opts.initTimeoutMs).toBeGreaterThan(60_000);
	});

	test("passes headless through", () => {
		expect(browserServerOptions({ headless: true }, "/tmp").env?.BROWSER_USE_HEADLESS).toBe("true");
		expect(browserServerOptions({ headless: false }, "/tmp").env?.BROWSER_USE_HEADLESS).toBe(
			"false",
		);
	});
});

describe("adaptBrowserTools", () => {
	test("drops tools that need their own LLM key or return images", () => {
		const names = adaptBrowserTools([
			tool("browser__browser_navigate"),
			tool("browser__browser_extract_content"),
			tool("browser__retry_with_browser_use_agent"),
			tool("browser__browser_screenshot"),
			tool("browser__browser_get_state"),
		]).map((t) => t.name);
		expect(names).toEqual(["browser__browser_navigate", "browser__browser_get_state"]);
	});

	test("marks read-only tools and leaves actions unknown", () => {
		const [nav, state] = adaptBrowserTools([
			tool("browser__browser_navigate"),
			tool("browser__browser_get_state"),
		]);
		expect(nav?.annotations).toEqual(UNKNOWN_TOOL_ANNOTATIONS);
		expect(state?.annotations).toEqual(READ_ONLY_ANNOTATIONS);
	});

	test("turns the server's failure text into a tool error", async () => {
		const failures = [
			"Error: No browser session active",
			"Element with index 9999 not found",
			"No element found for selector: #nope",
		];
		for (const text of failures) {
			const [adapted] = adaptBrowserTools([tool("browser__browser_click", text)]);
			expect((await adapted?.handler({}))?.isError).toBe(true);
		}
	});

	test("leaves normal results alone", async () => {
		const ok = [
			"Scrolled down",
			'{"url":"https://example.com/","title":"Error handling guide"}',
			"Clicked element 33",
		];
		for (const text of ok) {
			const [adapted] = adaptBrowserTools([tool("browser__browser_scroll", text)]);
			expect((await adapted?.handler({}))?.isError).toBe(false);
		}
	});
});

describe("browserSetupHint", () => {
	test("explains a missing uvx", () => {
		expect(browserSetupHint(new Error('Executable not found in $PATH: "uvx"'))).toContain(
			"https://docs.astral.sh/uv/",
		);
	});

	test("keeps other errors short", () => {
		const hint = browserSetupHint(
			new Error(Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n")),
		);
		expect(hint.split("\n")).toHaveLength(6);
	});
});
