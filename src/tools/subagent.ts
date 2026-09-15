import type { AgentEventEmitter } from "../core/events.ts";
import { errorResult, type McpToolDefinition, textResult } from "../core/mcp.ts";
import { type Skill, skillBodiesForNames } from "../skills/loader.ts";

export interface TaskToolOptions {
	skills: Skill[];
	/** Current parent-turn emitter (nested tool cards, approval). */
	parentEmit: () => AgentEventEmitter;
	/** Nested turn. Must not include another `task` tool. */
	run: (input: {
		prompt: string;
		label: string;
		extraSystem: string;
		emit: AgentEventEmitter;
	}) => Promise<void>;
}

/**
 * Spawn a one-shot nested agent. Subagents do not get this tool, so depth is 1.
 */
export function createTaskTool(options: TaskToolOptions): McpToolDefinition {
	return {
		name: "task",
		description:
			"Spawn a subagent for a focused job (research, an isolated edit, one copy-pipeline step). " +
			"Pass a complete prompt. Optional `skills` injects those skill bodies into the subagent. " +
			"Returns the subagent's final reply. Do not use for a one-line question.",
		inputSchema: {
			type: "object",
			properties: {
				prompt: { type: "string", description: "The full task for the subagent." },
				label: {
					type: "string",
					description: "Short name shown in the transcript (e.g. copy-edit).",
				},
				skills: {
					type: "array",
					items: { type: "string" },
					description: "Skill names to load into the subagent system prompt.",
				},
			},
			required: ["prompt"],
		},
		async handler(raw) {
			const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
			if (!prompt) return errorResult("prompt is empty");
			const label =
				typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : "subagent";
			const names = Array.isArray(raw.skills)
				? raw.skills.filter((s): s is string => typeof s === "string")
				: [];
			const extraSystem = skillBodiesForNames(options.skills, names);
			let nestedText = "";
			let nestedError: string | undefined;
			const parent = options.parentEmit();
			const emit: AgentEventEmitter = (event) => {
				if (event.kind === "text_delta") nestedText += event.text;
				else if (event.kind === "error") {
					nestedError = event.message;
					parent(event);
				} else if (event.kind !== "session_meta" && event.kind !== "completion") {
					parent(event);
				}
			};
			try {
				await options.run({ prompt, label, extraSystem, emit });
				if (nestedError) return errorResult(nestedError);
				return textResult(nestedText.trim() || "(subagent produced no text)");
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};
}
