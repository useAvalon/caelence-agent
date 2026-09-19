import { noopObservability } from "../observability/noop.ts";
import { sanitize } from "../observability/sanitize.ts";
import type { Observability } from "../observability/types.ts";
import type { ApprovalGate } from "./approval.ts";
import { isFileWriteTool, isRiskyToolCall } from "./approval.ts";
import { errorMessage, isAbortError } from "./errors.ts";
import type { AgentEventEmitter, MainModelProvider } from "./events.ts";
import type { HookRunner } from "./hooks.ts";
import { newId } from "./ids.ts";
import {
	errorResult,
	type McpServer,
	type McpToolDefinition,
	type ToolResult,
	toolResultText,
} from "./mcp.ts";
import type { AgentMode } from "./mode.ts";
import { modePrompt } from "./mode.ts";
import {
	compactionSummaries,
	DEFAULT_CONTEXT_WINDOW_TOKENS,
	replaceUserTurn,
	type Session,
	type SessionMessage,
	type SessionStore,
	type SummarizerFn,
	sessionToProviderMessages,
	titleFromUserMessage,
} from "./session.ts";
import type { AgentTool, ConstructAgent, ConstructedAgent } from "./strands.ts";

const REJECTED_TOOL_MESSAGE = "was denied approval and was not invoked";

export interface TurnRequest {
	message: string;
	sessionId?: string;
	model?: string;
	editUserTurn?: number;
}

export interface RunTurnDeps {
	cwd: string;
	name: string;
	systemPrompt: string;
	tools: McpToolDefinition[];
	mcp?: McpServer;
	approval: ApprovalGate;
	store: SessionStore;
	provider: MainModelProvider;
	constructAgent: ConstructAgent;
	resolveProvider?: (modelId: string) => MainModelProvider;
	summarize?: SummarizerFn;
	contextWindowTokens?: number;
	maxTokens?: number;
	observability?: Observability;
	traceName?: string;
	requestType?: string;
	agentVersion?: string;
	userId?: string;
	hooks?: HookRunner;
	mode?: AgentMode;
}

export async function runTurn(
	deps: RunTurnDeps,
	req: TurnRequest,
	emit: AgentEventEmitter,
	options: { signal?: AbortSignal } = {},
): Promise<Session | undefined> {
	let session: Session | undefined;
	try {
		if (req.sessionId) session = await deps.store.get(req.sessionId);
		if (req.editUserTurn !== undefined) {
			if (!session) throw new Error("No session to edit.");
			session = await deps.store.save(replaceUserTurn(session, req.editUserTurn, req.message));
		} else {
			if (!session) session = await deps.store.create(deps.systemPrompt, req.model);
			session = await deps.store.append(session, {
				kind: "turn",
				role: "user",
				content: req.message,
			});
			if (!session.title || session.title === "New chat") {
				session = await deps.store.setTitle(session, titleFromUserMessage(req.message));
			}
		}
		emit({ kind: "session_meta", sessionId: session.id, title: session.title });
	} catch (err) {
		if (req.editUserTurn !== undefined) {
			emit({ kind: "error", message: errorMessage(err) });
			return undefined;
		}
		session = undefined;
	}

	const obs = deps.observability ?? noopObservability;
	const startedAt = Date.now();
	return obs.startTurn(
		{
			name: deps.traceName ?? "agent_turn",
			input: { message: req.message },
			sessionId: session?.id,
			userId: deps.userId,
			metadata: {
				model: req.model ?? deps.provider.modelId,
				agentVersion: deps.agentVersion,
				requestType: deps.requestType ?? "chat",
				mode: deps.mode ?? "agent",
			},
		},
		async (root) => {
			let assistantText = "";
			let thoughtText = "";
			const openTools = new Map<string, { name: string; preview: string }>();
			let persistChain = Promise.resolve();
			const persistMessage = (message: SessionMessage) => {
				persistChain = persistChain
					.then(async () => {
						if (!session) return;
						session = await deps.store.append(session, message);
					})
					.catch(() => undefined);
			};
			const capture: AgentEventEmitter = (event) => {
				if (event.kind === "text_delta") assistantText += event.text;
				if (event.kind === "reasoning_delta") thoughtText += event.text;
				if (event.kind === "tool_call_start") {
					openTools.set(event.callId, {
						name: event.toolName,
						preview: previewToolInput(event.input),
					});
				}
				if (event.kind === "tool_call_end") {
					const started = openTools.get(event.callId);
					openTools.delete(event.callId);
					persistMessage({
						kind: "tool",
						name: event.toolName,
						callId: event.callId,
						status: event.success ? "ok" : "fail",
						preview: started?.preview ?? "",
						...(event.error ? { error: event.error } : {}),
						...(event.output ? { output: event.output } : {}),
					});
				}
				emit(event);
			};
			const closeOpenTools = (reason: string) => {
				for (const [callId, tool] of openTools) {
					capture({
						kind: "tool_call_end",
						toolName: tool.name,
						callId,
						success: false,
						error: reason,
					});
				}
			};

			let history: Array<{ role: "user" | "assistant"; content: string }> = [];
			let systemPrompt = deps.systemPrompt;
			if (session) {
				history = sessionToProviderMessages(session).slice(0, -1);
				const summaries = compactionSummaries(session);
				if (summaries.length > 0) {
					systemPrompt += `\n\n## Earlier conversation (summarized)\n${summaries.join("\n\n")}`;
				}
			}

			const toolDefs = deps.mcp ? deps.mcp.listTools() : deps.tools;
			const tools: AgentTool[] = toolDefs.map((def) =>
				guardTool(def, deps.approval, capture, obs, deps.hooks),
			);

			let agent: ConstructedAgent;
			const provider =
				req.model && deps.resolveProvider ? deps.resolveProvider(req.model) : deps.provider;
			try {
				agent = deps.constructAgent({
					systemPrompt,
					tools,
					provider,
					messages: history,
					maxTokens: deps.maxTokens,
				});
			} catch (err) {
				closeOpenTools("Turn stopped before this tool finished.");
				await persistChain;
				if (session) await finalize(deps, session, assistantText, thoughtText);
				capture({ kind: "error", message: errorMessage(err) });
				root.update({
					level: "ERROR",
					statusMessage: errorMessage(err),
					metadata: { status: "failed", generation_duration: Date.now() - startedAt },
				});
				await obs.flush();
				return session;
			}

			try {
				await obs.generation(
					"llm",
					async (gen) => {
						gen.update({ model: provider.modelId, input: { message: req.message } });
						await agent.run(req.message, capture, { signal: options.signal });
						const usage = provider.takeUsage?.();
						gen.update({
							output: assistantText,
							...(usage
								? {
										usage: {
											promptTokens: usage.promptTokens,
											completionTokens: usage.completionTokens,
											totalTokens: usage.totalTokens,
										},
									}
								: {}),
						});
						if (usage) {
							capture({
								kind: "usage",
								promptTokens: usage.promptTokens,
								completionTokens: usage.completionTokens,
								totalTokens: usage.totalTokens,
								...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
							});
							if (usage.costUsd !== undefined) {
								obs.score({ name: "cost_usd", value: usage.costUsd });
							}
							obs.score({ name: "prompt_tokens", value: usage.promptTokens });
							obs.score({ name: "completion_tokens", value: usage.completionTokens });
						}
					},
					{ model: provider.modelId },
				);
				await persistChain;
				if (session) session = await finalize(deps, session, assistantText, thoughtText);
				capture({ kind: "completion" });
				root.update({
					output: assistantText,
					metadata: { status: "success", generation_duration: Date.now() - startedAt },
				});
				obs.score({ name: "generation_duration", value: Date.now() - startedAt });
			} catch (err) {
				closeOpenTools("Turn stopped before this tool finished.");
				await persistChain;
				if (session) session = await finalize(deps, session, assistantText, thoughtText);
				if (options.signal?.aborted || isAbortError(err)) {
					capture({ kind: "completion" });
					root.update({
						metadata: { status: "aborted", generation_duration: Date.now() - startedAt },
					});
					await obs.flush();
					return session;
				}
				capture({ kind: "error", message: errorMessage(err) });
				root.update({
					level: "ERROR",
					statusMessage: errorMessage(err),
					metadata: { status: "failed", generation_duration: Date.now() - startedAt },
				});
			}
			await obs.flush();
			return session;
		},
	);
}

async function finalize(
	deps: RunTurnDeps,
	session: Session,
	assistantText: string,
	thoughtText = "",
): Promise<Session> {
	let next = session;
	const thought = thoughtText.trim();
	if (thought) {
		next = await deps.store.append(next, { kind: "thought", text: thought });
	}
	next = await deps.store.append(next, {
		kind: "turn",
		role: "assistant",
		content: assistantText,
	});
	if (deps.summarize) {
		try {
			next = await deps.store.maybeCompact(
				next,
				deps.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
				deps.summarize,
			);
		} catch {
			// fail-soft
		}
	}
	return next;
}

function guardTool(
	def: McpToolDefinition,
	approval: ApprovalGate,
	emit: AgentEventEmitter,
	obs: Observability,
	hooks?: HookRunner,
): AgentTool {
	return {
		name: def.name,
		description: def.description,
		inputSchema: def.inputSchema,
		invoke: (rawInput) => invokeGuarded(def, approval, emit, obs, rawInput ?? {}, hooks),
	};
}

async function invokeGuarded(
	def: McpToolDefinition,
	approval: ApprovalGate,
	emit: AgentEventEmitter,
	obs: Observability,
	rawInput: Record<string, unknown>,
	hooks?: HookRunner,
): Promise<ToolResult> {
	const callId = newId("call");
	const input = rawInput ?? {};
	return obs.tool(
		def.name,
		async (span) => {
			span.update({ input: sanitize(input) });
			const result = await invokeGuardedBody(def, approval, emit, callId, input, hooks);
			const success = !result.isError;
			span.update({
				output: sanitize(
					success ? (result.structuredContent ?? toolResultText(result)) : toolResultText(result),
				),
				metadata: { success, callId },
				...(success ? {} : { level: "ERROR" as const, statusMessage: toolResultText(result) }),
			});
			return result;
		},
		{ input: sanitize(input) },
	);
}

async function invokeGuardedBody(
	def: McpToolDefinition,
	approval: ApprovalGate,
	emit: AgentEventEmitter,
	callId: string,
	input: Record<string, unknown>,
	hooks?: HookRunner,
): Promise<ToolResult> {
	let result: ToolResult | undefined;
	let success = false;
	let errorText: string | undefined;

	try {
		emit({ kind: "tool_call_start", toolName: def.name, callId, input });
		const hook = await hooks?.preTool(def.name, input);
		if (hook && !hook.allow) {
			errorText = hook.reason ?? `Tool call "${def.name}" was blocked by a pre_tool hook.`;
			result = errorResult(errorText);
		}
		let approved = true;
		if (!result && (isRiskyToolCall(def.name) || isFileWriteTool(def.name))) {
			approved = await approval.request({ callId, toolName: def.name, input });
		}
		if (result) {
			// hook already denied
		} else if (!approved) {
			errorText = `Tool call "${def.name}" ${REJECTED_TOOL_MESSAGE}.`;
			result = errorResult(errorText);
		} else {
			try {
				const handlerResult = await def.handler(input);
				if (handlerResult.isError) {
					errorText = toolResultText(handlerResult);
					result = handlerResult;
				} else {
					result = handlerResult;
					success = true;
				}
			} catch (handlerErr) {
				errorText = errorMessage(handlerErr);
				result = errorResult(errorText);
			}
		}
	} catch (dispatchErr) {
		errorText = errorMessage(dispatchErr);
		result = errorResult(errorText);
	}

	const finalResult = result ?? errorResult("tool produced no result");
	void hooks?.postTool(def.name, input, success);
	if (success && def.name === "todo_write") {
		const items = (finalResult.structuredContent as { items?: unknown } | undefined)?.items;
		if (Array.isArray(items)) {
			emit({
				kind: "todos",
				items: items.filter(
					(item): item is { id: string; content: string; status: string } =>
						!!item &&
						typeof item === "object" &&
						typeof (item as { id?: unknown }).id === "string" &&
						typeof (item as { content?: unknown }).content === "string" &&
						typeof (item as { status?: unknown }).status === "string",
				),
			});
		}
	}
	emit({
		kind: "tool_call_end",
		toolName: def.name,
		callId,
		success,
		...(success ? { result: finalResult.structuredContent } : {}),
		...(success ? { output: clipToolOutput(toolResultText(finalResult)) } : {}),
		...(errorText !== undefined ? { error: errorText } : {}),
	});
	return finalResult;
}

function previewToolInput(input: Record<string, unknown>): string {
	const cmd = typeof input.command === "string" ? input.command : undefined;
	const path = typeof input.path === "string" ? input.path : undefined;
	const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
	const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
	const label = typeof input.label === "string" ? input.label : undefined;
	const raw = label ?? cmd ?? path ?? pattern ?? prompt ?? JSON.stringify(input);
	return raw.length > 80 ? `${raw.slice(0, 79)}…` : raw;
}

function clipToolOutput(text: string): string {
	const max = 8000;
	return text.length <= max ? text : `${text.slice(0, max)}\n…`;
}

export function buildSystemPrompt(input: {
	name: string;
	cwd: string;
	instructions?: string;
	userInstructions?: string;
	projectInstructions?: string;
	skillCatalog?: string;
	mode?: AgentMode;
}): string {
	const parts = [
		"You are a coding agent in this project.",
		`Project root: ${input.cwd}.`,
		"Prefer small, targeted edits. Use edit_file for snippets, write_file for new files.",
		"If the user asked to change a file, call write_file or edit_file before you reply. Do not say you wrote, edited, or saved a file unless that tool returned success.",
		"Use read_file, glob, and grep to inspect the repo. Do not use exec to read or search files.",
		"Use git_status, git_diff, and git_log for git. git_commit requires approval and does not push.",
		"Read skills with read_skill when a task matches a skill name. Spawn a subagent with task for a focused job.",
		"Use todo_write for multi-step work.",
		"Reply in plain text for a terminal. Do not use markdown.",
		"Do not introduce yourself. Do not list skills, tools, or capabilities unless the user asks.",
		"Do not invent metrics, testimonials, or sample numbers.",
	];
	if (input.mode) parts.push(modePrompt(input.mode));
	if (input.userInstructions?.trim()) {
		parts.push("## User instructions", input.userInstructions.trim());
	}
	if (input.projectInstructions?.trim()) {
		parts.push("## Project instructions", input.projectInstructions.trim());
	} else if (input.instructions?.trim()) {
		parts.push("## Instructions", input.instructions.trim());
	}
	if (input.skillCatalog?.trim()) parts.push(input.skillCatalog.trim());
	return parts.join("\n\n");
}

export function defaultSummarizer(provider: MainModelProvider): SummarizerFn {
	return async ({ messages }) => {
		const text = messages
			.map((m) => {
				if (m.kind === "turn") return `${m.role}: ${m.content}`;
				if (m.kind === "system") return `system: ${m.text}`;
				if (m.kind === "tool") return `tool ${m.name}: ${m.preview}`;
				if (m.kind === "thought") return `thought: ${m.text}`;
				return `summary: ${m.summary}`;
			})
			.join("\n")
			.slice(0, 24_000);
		let out = "";
		for await (const event of provider.stream({
			system:
				"Summarize this conversation span in a few short paragraphs. Keep facts. No preamble.",
			messages: [{ role: "user", content: text }],
			maxTokens: 800,
		})) {
			if (event.type === "text_delta") out += event.text;
			if (event.type === "error") throw new Error(event.message);
		}
		return out.trim() || "Earlier turns were compacted.";
	};
}
