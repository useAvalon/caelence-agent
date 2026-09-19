import { describe, expect, test } from "bun:test";
import { prettifyToolName, toolLabel } from "./tool-label.ts";

describe("tool labels", () => {
	test("sentence-cases snake names and drops MCP namespaces", () => {
		expect(prettifyToolName("write_file")).toBe("Write file");
		expect(toolLabel("notion__notion_fetch")).toBe("Notion fetch");
		expect(toolLabel("notion__notion_list_recent_pages")).toBe("Notion list recent pages");
		expect(toolLabel("google-sheets__get_range")).toBe("Google sheets get range");
	});

	test("uses path and command when the builder would", () => {
		expect(toolLabel("write_file", { path: "src/app.css" })).toBe("Writing src/app.css");
		expect(toolLabel("exec", { command: "bun test" })).toBe("Running: bun test");
		expect(toolLabel("web_search")).toBe("Searching the web");
	});

	test("uses an active phrase for a lone tool name", () => {
		expect(toolLabel("task")).toBe("Handling task");
		expect(toolLabel("mystery")).toBe("Using mystery");
	});

	test("names the skill on read_skill and task", () => {
		expect(toolLabel("read_skill", { name: "copy-harry-dry" })).toBe("Reading Harry Dry");
		expect(toolLabel("task", { label: "copy-edit", skills: ["copy-editor"] })).toBe(
			"Handling copy-edit",
		);
	});
});
