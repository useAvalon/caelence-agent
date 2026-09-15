import { describe, expect, test } from "bun:test";
import type { McpToolDefinition } from "./mcp.ts";
import {
	filterToolsForMode,
	parseAgentMode,
	toolsAllowedInMode,
	tryParseAgentMode,
} from "./mode.ts";

function stub(name: string): McpToolDefinition {
	return {
		name,
		description: name,
		inputSchema: { type: "object", properties: {} },
		async handler() {
			return { content: [{ type: "text", text: name }] };
		},
	};
}

const tools = [
	stub("read_file"),
	stub("write_file"),
	stub("todo_write"),
	stub("exec"),
	stub("git_status"),
	stub("git_commit"),
	stub("task"),
];

describe("agent mode", () => {
	test("parses known modes and rejects the rest", () => {
		expect(tryParseAgentMode("ASK")).toBe("ask");
		expect(tryParseAgentMode("plan")).toBe("plan");
		expect(tryParseAgentMode("agent")).toBe("agent");
		expect(tryParseAgentMode("debug")).toBeUndefined();
		expect(parseAgentMode("nope")).toBe("agent");
		expect(parseAgentMode(undefined)).toBe("agent");
	});

	test("ask is read-only", () => {
		const names = filterToolsForMode("ask", tools).map((tool) => tool.name);
		expect(names).toEqual(["read_file", "git_status"]);
		expect(toolsAllowedInMode("ask", "write_file")).toBe(false);
		expect(toolsAllowedInMode("ask", "todo_write")).toBe(false);
		expect(toolsAllowedInMode("ask", "exec")).toBe(false);
		expect(toolsAllowedInMode("ask", "git_commit")).toBe(false);
		expect(toolsAllowedInMode("ask", "task")).toBe(false);
	});

	test("plan adds todos only", () => {
		const names = filterToolsForMode("plan", tools).map((tool) => tool.name);
		expect(names).toEqual(["read_file", "todo_write", "git_status"]);
		expect(toolsAllowedInMode("plan", "write_file")).toBe(false);
		expect(toolsAllowedInMode("plan", "git_commit")).toBe(false);
	});

	test("agent keeps every tool", () => {
		expect(filterToolsForMode("agent", tools).map((tool) => tool.name)).toEqual(
			tools.map((tool) => tool.name),
		);
	});
});
