import type { McpToolDefinition } from "../core/mcp.ts";
import { BERRY_AGENT_TURN_PREFIX, BERRY_CONVERSATION_TURN_PREFIX } from "./berry-prompt.ts";

export function wrapBerryTurnMessage(message: string, conversational: boolean): string {
	const prefix = conversational ? BERRY_CONVERSATION_TURN_PREFIX : BERRY_AGENT_TURN_PREFIX;
	return `${prefix}\n\n${message.trim()}`;
}

export function filterBerryToolsForTurn(
	tools: McpToolDefinition[],
	conversational: boolean,
): McpToolDefinition[] {
	if (process.env.HARNESS_BERRY !== "1") return tools;
	if (!conversational) return tools;
	return tools.filter((tool) => tool.name !== "open_search");
}
