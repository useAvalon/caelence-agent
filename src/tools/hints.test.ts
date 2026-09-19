import { describe, expect, test } from "bun:test";
import type { McpToolAnnotations } from "../core/mcp.ts";
import { createGitTools } from "./git.ts";
import { createLocalTools } from "./local.ts";
import { createReadSkillTool } from "./read-skill.ts";
import { createTaskTool } from "./subagent.ts";
import { createMemoryTodoStore, createTodoTool } from "./todo.ts";

function expectHints(hints: McpToolAnnotations): void {
	expect(typeof hints.readOnlyHint).toBe("boolean");
	expect(typeof hints.destructiveHint).toBe("boolean");
	expect(typeof hints.idempotentHint).toBe("boolean");
	expect(typeof hints.openWorldHint).toBe("boolean");
}

describe("built-in tool hints", () => {
	test("every local, git, todo, skill, and task tool declares all four hints", () => {
		const tools = [
			...createLocalTools({ cwd: process.cwd() }).listTools(),
			...createGitTools(process.cwd()),
			createTodoTool(createMemoryTodoStore()),
			createReadSkillTool([]),
			createTaskTool({
				skills: [],
				parentEmit: () => () => undefined,
				run: async () => undefined,
			}),
		];
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			"edit_file",
			"exec",
			"git_commit",
			"git_diff",
			"git_log",
			"git_status",
			"glob",
			"grep",
			"read_file",
			"read_skill",
			"task",
			"todo_write",
			"write_file",
		]);
		for (const tool of tools) {
			expectHints(tool.annotations);
		}
	});
});
