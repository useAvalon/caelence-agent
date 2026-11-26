/**
 * Agent event kinds. `error` and `completion` are the two terminal kinds.
 */

import type { TokenUsage } from "./usage.ts";

export type AgentEvent =
	| { kind: "text_delta"; text: string }
	| { kind: "reasoning_delta"; text: string }
	| { kind: "tool_call_start"; toolName: string; callId: string; input: Record<string, unknown> }
	| {
			kind: "tool_call_end";
			toolName: string;
			callId: string;
			success: boolean;
			result?: unknown;
			output?: string;
			error?: string;
	  }
	| {
			kind: "approval_request";
			callId: string;
			toolName: string;
			input: Record<string, unknown>;
			reason?: string;
	  }
	| { kind: "session_meta"; sessionId: string; title: string }
	/**
	 * Sent once at the start of a turn: the verbs a UI rotates through while the agent is thinking
	 * ("Pondering", "Brewing"). A UI that ignores it shows its own plain label.
	 */
	| { kind: "status"; verbs: string[] }
	| {
			kind: "usage";
			promptTokens: number;
			completionTokens: number;
			totalTokens: number;
			costUsd?: number;
	  }
	| {
			kind: "todos";
			items: Array<{ id: string; content: string; status: string }>;
	  }
	| { kind: "error"; message: string }
	| { kind: "completion" };

export type AgentEventEmitter = (event: AgentEvent) => void;

export const AGENT_TERMINAL_KINDS: ReadonlySet<AgentEvent["kind"]> = new Set([
	"completion",
	"error",
]);

export function isTerminalAgentEvent(event: AgentEvent): boolean {
	return AGENT_TERMINAL_KINDS.has(event.kind);
}

export interface ProviderMessage {
	role: "user" | "assistant";
	content: string;
}

export interface ProviderToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface ProviderTurnRequest {
	system?: string;
	messages: ProviderMessage[];
	tools?: ProviderToolDefinition[];
	maxTokens?: number;
}

export type ProviderStreamEvent =
	| { type: "text_delta"; text: string }
	| { type: "reasoning_delta"; text: string }
	| { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
	| { type: "error"; message: string }
	| { type: "done" };

export interface MainModelProvider {
	readonly kind: string;
	readonly modelId: string;
	stream(
		request: ProviderTurnRequest,
		options?: { signal?: AbortSignal },
	): AsyncIterable<ProviderStreamEvent>;
	/**
	 * Billed usage for the turn's model calls, if the provider reported it.
	 * May return a promise so streamed OpenRouter usage can finish arriving.
	 */
	takeUsage?(): TokenUsage | undefined | Promise<TokenUsage | undefined>;
}
