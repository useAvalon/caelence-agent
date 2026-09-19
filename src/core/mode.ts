import type { McpToolDefinition } from "./mcp.ts";

export const AGENT_MODES = ["ask", "plan", "agent"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

const READ_TOOLS = new Set([
	"read_file",
	"glob",
	"grep",
	"read_skill",
	"git_status",
	"git_diff",
	"git_log",
]);

const PLAN_TOOLS = new Set([...READ_TOOLS, "todo_write"]);

export function tryParseAgentMode(raw: string | undefined): AgentMode | undefined {
	const value = raw?.trim().toLowerCase();
	return value === "ask" || value === "plan" || value === "agent" ? value : undefined;
}

export function parseAgentMode(raw: string | undefined): AgentMode {
	return tryParseAgentMode(raw) ?? "agent";
}

export function toolsAllowedInMode(mode: AgentMode, name: string): boolean {
	if (mode === "agent") return true;
	if (mode === "plan") return PLAN_TOOLS.has(name);
	return READ_TOOLS.has(name);
}

export function filterToolsForMode(
	mode: AgentMode,
	tools: McpToolDefinition[],
): McpToolDefinition[] {
	return tools.filter((tool) => toolsAllowedInMode(mode, tool.name));
}

export function modePrompt(mode: AgentMode): string {
	if (mode === "ask") {
		return [
			"## Mode: ask",
			"Answer questions only. You may read the repo. You cannot edit files, run exec, commit, or spawn task.",
			"If a change is needed, describe it. Do not pretend you applied it.",
		].join("\n");
	}
	if (mode === "plan") {
		return [
			"## Mode: plan",
			"Inspect the repo and write a plan. Use todo_write for the steps.",
			"Do not edit files, run exec, or commit. Wait for agent mode to implement.",
		].join("\n");
	}
	return [
		"## Mode: agent",
		"You may edit files, run approved exec, and commit when the user asked for the change.",
		"If they asked to change a file, call write_file or edit_file. Do not claim the write until the tool succeeds.",
		"Use todo_write for multi-step work. Prefer git_status / git_diff / git_log over exec for git.",
	].join("\n");
}
