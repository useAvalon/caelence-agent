import { describe, expect, test } from "bun:test";
import {
	formatPlatformOutput,
	isPlatformTool,
	matchPlatform,
	platformTitle,
	toolEventOutput,
} from "./platform.ts";

describe("platform tools", () => {
	test("reads the MCP namespace", () => {
		expect(isPlatformTool("notion__notion_fetch")).toBe(true);
		expect(isPlatformTool("read_file")).toBe(false);
		expect(platformTitle("notion__notion_fetch", [{ id: "notion", label: "Notion" }])).toBe(
			"Notion",
		);
		expect(
			platformTitle("google_sheets__get_range", [{ id: "google-sheets", label: "Google Sheets" }]),
		).toBe("Google Sheets");
		expect(matchPlatform("canva__list_designs", [{ id: "canva", label: "Canva" }])?.id).toBe(
			"canva",
		);
	});

	test("pretty-prints JSON tool payloads", () => {
		expect(formatPlatformOutput('{"title":"Notes"}')).toBe('{\n  "title": "Notes"\n}');
		expect(toolEventOutput({ text: "hello" })).toBe("hello");
		expect(toolEventOutput({ content: [{ type: "text", text: "page" }] })).toBe("page");
	});
});
