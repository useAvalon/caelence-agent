/**
 * The only module that imports @strands-agents/sdk.
 */

import type { JSONSchema, Model, StreamOptions, ToolSpec } from "@strands-agents/sdk";
import { Agent, Message, type ModelStreamUpdateEvent, TextBlock, tool } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { PRODUCT_NAME } from "../product.ts";
import { withAutoRouterFetch } from "./auto-router.ts";
import { errorMessage } from "./errors.ts";
import type {
	AgentEventEmitter,
	MainModelProvider,
	ProviderStreamEvent,
	ProviderTurnRequest,
} from "./events.ts";
import type { ToolResult } from "./mcp.ts";
import { createUsageTrackingFetch, type TokenUsage } from "./usage.ts";

export const DEFAULT_MAIN_MODEL_MAX_TOKENS = 8192;

export interface AgentTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	invoke(input: Record<string, unknown>): Promise<ToolResult>;
}

export interface AgentConstructionInput {
	systemPrompt: string;
	tools: AgentTool[];
	provider: MainModelProvider;
	messages: Array<{ role: "user" | "assistant"; content: string }>;
	maxTokens?: number;
}

export interface ConstructedAgent {
	run(
		userMessage: string,
		emit: AgentEventEmitter,
		options?: { signal?: AbortSignal },
	): Promise<void>;
}

export type ConstructAgent = (input: AgentConstructionInput) => ConstructedAgent;

export interface StrandsBackedProvider extends MainModelProvider {
	readonly sdkModel: Model;
	setReasoningSink?(sink: ((text: string) => void) | undefined): void;
}

function isStrandsBackedProvider(p: MainModelProvider): p is StrandsBackedProvider {
	return "sdkModel" in p && (p as StrandsBackedProvider).sdkModel !== undefined;
}

function parseToolInput(raw: string): Record<string, unknown> {
	if (raw.trim() === "") return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

async function* streamModelAsProviderEvents(
	model: Model,
	request: ProviderTurnRequest,
	signal?: AbortSignal,
): AsyncIterable<ProviderStreamEvent> {
	const messages = request.messages.map(
		(m) => new Message({ role: m.role, content: [new TextBlock(m.content)] }),
	);
	const options: StreamOptions = {};
	if (request.system) options.systemPrompt = request.system;
	if (request.tools?.length) {
		options.toolSpecs = request.tools.map(
			(t): ToolSpec => ({
				name: t.name,
				description: t.description,
				inputSchema: t.inputSchema as JSONSchema,
			}),
		);
	}

	let pendingTool: { id: string; name: string; input: string } | undefined;
	try {
		for await (const event of model.stream(messages, options)) {
			if (signal?.aborted) {
				yield { type: "done" };
				return;
			}
			switch (event.type) {
				case "modelContentBlockStartEvent":
					if (event.start?.type === "toolUseStart") {
						pendingTool = { id: event.start.toolUseId, name: event.start.name, input: "" };
					}
					break;
				case "modelContentBlockDeltaEvent":
					if (event.delta.type === "textDelta") {
						if (event.delta.text.length > 0) yield { type: "text_delta", text: event.delta.text };
					} else if (
						event.delta.type === "reasoningContentDelta" &&
						event.delta.text &&
						event.delta.text.length > 0
					) {
						yield { type: "reasoning_delta", text: event.delta.text };
					} else if (event.delta.type === "toolUseInputDelta" && pendingTool) {
						pendingTool.input += event.delta.input;
					}
					break;
				case "modelContentBlockStopEvent":
					if (pendingTool) {
						yield {
							type: "tool_call",
							id: pendingTool.id,
							name: pendingTool.name,
							input: parseToolInput(pendingTool.input),
						};
						pendingTool = undefined;
					}
					break;
				default:
					break;
			}
		}
		yield { type: "done" };
	} catch (err) {
		yield { type: "error", message: errorMessage(err) };
	}
}

function wrapModelAsProvider(
	model: Model,
	kind: string,
	modelId: string,
	takeUsage?: () => TokenUsage | undefined,
): StrandsBackedProvider {
	return {
		kind,
		modelId,
		sdkModel: model,
		takeUsage,
		stream(request, streamOptions) {
			return streamModelAsProviderEvents(model, request, streamOptions?.signal);
		},
	};
}

export function constructOpenRouterProvider(options: {
	apiKey: string;
	model: string;
	baseUrl: string;
	maxTokens?: number;
	sessionId?: () => string | undefined;
}): MainModelProvider {
	let lastUsage: TokenUsage | undefined;
	let reasoningSink: ((text: string) => void) | undefined;
	const model = new OpenAIModel({
		api: "chat",
		apiKey: options.apiKey,
		modelId: options.model,
		maxTokens: options.maxTokens ?? DEFAULT_MAIN_MODEL_MAX_TOKENS,
		params: {
			reasoning: { effort: "low", exclude: false },
			stream_options: { include_usage: true },
		},
		clientConfig: {
			baseURL: options.baseUrl.replace(/\/+$/, ""),
			defaultHeaders: {
				"HTTP-Referer": "https://caelence.com",
				"X-Title": PRODUCT_NAME,
			},
			fetch: createUsageTrackingFetch(
				(usage) => {
					lastUsage = usage;
				},
				withAutoRouterFetch(globalThis.fetch, {
					model: options.model,
					sessionId: options.sessionId,
				}),
				(text) => reasoningSink?.(text),
			),
		},
	});
	const wrapped = wrapModelAsProvider(model, "openrouter", options.model, () => {
		const usage = lastUsage;
		lastUsage = undefined;
		return usage;
	});
	wrapped.setReasoningSink = (sink) => {
		reasoningSink = sink;
	};
	return wrapped;
}

function toolResultToReturn(result: ToolResult): unknown {
	if (result.structuredContent) return result.structuredContent;
	return result.content.map((block) => block.text).join("\n");
}

export function createConstructAgent(): ConstructAgent {
	return (input: AgentConstructionInput): ConstructedAgent => {
		if (!isStrandsBackedProvider(input.provider)) {
			throw new Error("createConstructAgent requires a Strands-backed MainModelProvider.");
		}
		const provider = input.provider;
		const model = provider.sdkModel;
		const tools = input.tools.map((agentTool: AgentTool) =>
			tool({
				name: agentTool.name,
				description: agentTool.description,
				inputSchema: agentTool.inputSchema as JSONSchema,
				callback: async (rawInput: unknown) => {
					const result = await agentTool.invoke((rawInput ?? {}) as Record<string, unknown>);
					return toolResultToReturn(result) as never;
				},
			}),
		);
		const seededMessages = input.messages.map(
			(m) => new Message({ role: m.role, content: [new TextBlock(m.content)] }),
		);
		const agent = new Agent({
			model,
			systemPrompt: input.systemPrompt,
			tools,
			...(seededMessages.length > 0 ? { messages: seededMessages } : {}),
		});

		return {
			async run(userMessage, emit, options) {
				const invokeOptions = options?.signal ? { cancelSignal: options.signal } : {};
				provider.setReasoningSink?.((text) => emit({ kind: "reasoning_delta", text }));
				try {
					for await (const event of agent.stream(userMessage, invokeOptions)) {
						if (event.type === "modelStreamUpdateEvent") {
							const modelEvent = (event as ModelStreamUpdateEvent).event;
							if (modelEvent.type !== "modelContentBlockDeltaEvent") continue;
							if (modelEvent.delta.type === "textDelta" && modelEvent.delta.text.length > 0) {
								emit({ kind: "text_delta", text: modelEvent.delta.text });
							} else if (
								modelEvent.delta.type === "reasoningContentDelta" &&
								modelEvent.delta.text &&
								modelEvent.delta.text.length > 0
							) {
								emit({ kind: "reasoning_delta", text: modelEvent.delta.text });
							}
						}
					}
				} catch (err) {
					if (options?.signal?.aborted) return;
					const name =
						err && typeof err === "object" ? (err as { name?: unknown }).name : undefined;
					if (name === "AbortError" || name === "CancelledError") return;
					throw err;
				} finally {
					provider.setReasoningSink?.(undefined);
				}
			},
		};
	};
}
