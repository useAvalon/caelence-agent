import type { ResolvedDecisions } from "../decisions/config.ts";
import type { ShortcutPlanner } from "../decisions/shortcuts.ts";
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
	isModelContextMessage,
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
	/** What the model sees as the user's message. */
	message: string;
	sessionId?: string;
	model?: string;
	editUserTurn?: number;
	/**
	 * What the transcript stores and titles the chat with, when it differs from `message`. A host
	 * can prefix instructions to `message` for the model without them showing up in the chat.
	 */
	displayMessage?: string;
	/** Appended to the system prompt for this turn only. */
	systemAppend?: string;
	/** Tool names hidden from the model for this turn only. */
	excludeTools?: readonly string[];
}

/** What a host `intercept` hook can do with a turn. */
export interface TurnInterceptContext {
	message: string;
	history: Array<{ role: "user" | "assistant"; content: string }>;
	toolNames: ReadonlySet<string>;
	emit: AgentEventEmitter;
	signal?: AbortSignal;
}

/**
 * Handle a whole turn without the chat model, for example a computer-use agent. Return a reply
 * to end the turn with it, or undefined to let the normal agent answer. Text sent through
 * `emit` is part of the reply. Throwing falls through to the normal agent.
 */
export type TurnInterceptor = (ctx: TurnInterceptContext) => Promise<{ reply: string } | undefined>;

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
	/** Decision-model settings. When set, hosts may answer simple messages with one tool call. */
	decisions?: ResolvedDecisions;
	/** Host judgment of which messages are a direct tool call. Needs `decisions`. */
	shortcut?: ShortcutPlanner;
	/** Host handler that can answer a whole turn without the chat model. */
	intercept?: TurnInterceptor;
}

export async function runTurn(
	deps: RunTurnDeps,
	req: TurnRequest,
	emit: AgentEventEmitter,
	options: { signal?: AbortSignal } = {},
): Promise<Session | undefined> {
	let session: Session | undefined;
	const stored = req.displayMessage ?? req.message;
	try {
		if (req.sessionId) session = await deps.store.get(req.sessionId);
		if (req.editUserTurn !== undefined) {
			if (!session) throw new Error("No session to edit.");
			session = await deps.store.save(replaceUserTurn(session, req.editUserTurn, stored));
		} else {
			session ??= await deps.store.create(deps.systemPrompt, req.model);
			session = await deps.store.append(session, {
				kind: "turn",
				role: "user",
				content: stored,
			});
			if (!session.title || session.title === "New chat") {
				session = await deps.store.setTitle(session, titleFromUserMessage(stored));
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

			const appended = req.systemAppend?.trim();
			if (appended) systemPrompt += `\n\n${appended}`;
			const allDefs = deps.mcp ? deps.mcp.listTools() : deps.tools;
			const hidden = new Set(req.excludeTools ?? []);
			const toolDefs = hidden.size > 0 ? allDefs.filter((def) => !hidden.has(def.name)) : allDefs;
			const tools: AgentTool[] = toolDefs.map((def) =>
				guardTool(def, deps.approval, capture, obs, deps.hooks),
			);

			// End the turn with a reply the chat model did not write. A storage failure while saving it
			// ends the turn with an error instead of rejecting out of the trace callback.
			const finishWithReply = async (decision: string): Promise<Session | undefined> => {
				await persistChain;
				try {
					if (session) session = await finalize(deps, session, assistantText, thoughtText);
				} catch (err) {
					capture({ kind: "error", message: errorMessage(err) });
					root.update({
						level: "ERROR",
						statusMessage: errorMessage(err),
						metadata: { status: "failed", generation_duration: Date.now() - startedAt },
					});
					await obs.flush();
					return session;
				}
				capture({ kind: "completion" });
				root.update({
					output: assistantText,
					metadata: { status: "success", generation_duration: Date.now() - startedAt, decision },
				});
				await obs.flush();
				return session;
			};

			if (session && req.editUserTurn === undefined && deps.intercept) {
				const outcome = await tryIntercept(
					deps.intercept,
					{
						message: req.message,
						history,
						toolNames: new Set(toolDefs.map((def) => def.name)),
						emit: capture,
						signal: options.signal,
					},
					() => assistantText.length > 0,
				);
				if (outcome.kind === "reply") {
					if (!assistantText) capture({ kind: "text_delta", text: outcome.reply });
					return finishWithReply("intercept");
				}
				if (outcome.kind === "failed") {
					await persistChain;
					if (session)
						session = await finalize(deps, session, assistantText, thoughtText).catch(
							() => session,
						);
					capture({ kind: "error", message: errorMessage(outcome.error) });
					root.update({
						level: "ERROR",
						statusMessage: errorMessage(outcome.error),
						metadata: { status: "failed", generation_duration: Date.now() - startedAt },
					});
					await obs.flush();
					return session;
				}
			}

			if (session && req.editUserTurn === undefined && deps.shortcut && deps.decisions?.shortcuts) {
				const outcome = await tryShortcut(deps, stored, toolDefs, tools, options.signal);
				if (outcome?.kind === "answered") {
					capture({ kind: "text_delta", text: outcome.reply });
					return finishWithReply("shortcut");
				}
				if (outcome?.kind === "continue" && outcome.agentNote) {
					systemPrompt += `\n\n${outcome.agentNote}`;
				}
			}

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

type InterceptOutcome =
	| { kind: "reply"; reply: string }
	| { kind: "pass" }
	| { kind: "failed"; error: unknown };

/**
 * Run the host interceptor. A throw before it produced any output passes the turn to the normal
 * agent. A throw after output has already reached the user is a failure, because answering again
 * would show two answers glued together.
 */
async function tryIntercept(
	intercept: TurnInterceptor,
	ctx: TurnInterceptContext,
	producedOutput: () => boolean,
): Promise<InterceptOutcome> {
	try {
		const result = await intercept(ctx);
		return result ? { kind: "reply", reply: result.reply } : { kind: "pass" };
	} catch (err) {
		return producedOutput() ? { kind: "failed", error: err } : { kind: "pass" };
	}
}

type ShortcutOutcome =
	| { kind: "answered"; reply: string }
	| { kind: "continue"; agentNote?: string };

/**
 * Run the host's shortcut plan as one ordinary guarded tool call, so approval, hooks, tracing,
 * and tool events behave exactly as they do for the model. Any failure returns undefined and the
 * agent answers normally.
 */
async function tryShortcut(
	deps: RunTurnDeps,
	message: string,
	toolDefs: McpToolDefinition[],
	tools: AgentTool[],
	signal?: AbortSignal,
): Promise<ShortcutOutcome | undefined> {
	const { decisions, shortcut } = deps;
	if (!decisions || !shortcut) return undefined;
	try {
		const plan = await shortcut({
			message,
			toolNames: new Set(toolDefs.map((def) => def.name)),
			decisions,
			signal,
		});
		if (!plan) return undefined;
		const tool = tools.find((candidate) => candidate.name === plan.toolName);
		if (!tool) return undefined;
		const result = await tool.invoke(plan.input);
		if (result.isError) return undefined;
		if (plan.continueWithAgent) return { kind: "continue", agentNote: plan.agentNote };
		return { kind: "answered", reply: plan.reply };
	} catch {
		return undefined;
	}
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

async function blockedByPreTool(
	def: McpToolDefinition,
	input: Record<string, unknown>,
	hooks?: HookRunner,
): Promise<string | undefined> {
	const hook = await hooks?.preTool(def.name, input);
	if (hook && !hook.allow) {
		return hook.reason ?? `Tool call "${def.name}" was blocked by a pre_tool hook.`;
	}
	return undefined;
}

async function approvalGranted(
	def: McpToolDefinition,
	approval: ApprovalGate,
	callId: string,
	input: Record<string, unknown>,
): Promise<boolean> {
	if (!isRiskyToolCall(def.name) && !isFileWriteTool(def.name)) return true;
	return approval.request({ callId, toolName: def.name, input });
}

async function runToolHandler(
	def: McpToolDefinition,
	input: Record<string, unknown>,
): Promise<{ result: ToolResult; success: boolean; errorText?: string }> {
	try {
		const handlerResult = await def.handler(input);
		if (handlerResult.isError) {
			return {
				result: handlerResult,
				success: false,
				errorText: toolResultText(handlerResult),
			};
		}
		return { result: handlerResult, success: true };
	} catch (handlerErr) {
		const errorText = errorMessage(handlerErr);
		return { result: errorResult(errorText), success: false, errorText };
	}
}

function isTodoItem(item: unknown): item is { id: string; content: string; status: string } {
	if (!item || typeof item !== "object") return false;
	const row = item as { id?: unknown; content?: unknown; status?: unknown };
	return (
		typeof row.id === "string" && typeof row.content === "string" && typeof row.status === "string"
	);
}

function emitTodosIfNeeded(
	def: McpToolDefinition,
	result: ToolResult,
	emit: AgentEventEmitter,
	success: boolean,
): void {
	if (!success || def.name !== "todo_write") return;
	const items = (result.structuredContent as { items?: unknown } | undefined)?.items;
	if (!Array.isArray(items)) return;
	emit({ kind: "todos", items: items.filter(isTodoItem) });
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
		const blocked = await blockedByPreTool(def, input, hooks);
		if (blocked) {
			errorText = blocked;
			result = errorResult(errorText);
		} else if (!(await approvalGranted(def, approval, callId, input))) {
			errorText = `Tool call "${def.name}" ${REJECTED_TOOL_MESSAGE}.`;
			result = errorResult(errorText);
		} else {
			const ran = await runToolHandler(def, input);
			result = ran.result;
			success = ran.success;
			errorText = ran.errorText;
		}
	} catch (dispatchErr) {
		errorText = errorMessage(dispatchErr);
		result = errorResult(errorText);
	}

	const finalResult = result ?? errorResult("tool produced no result");
	void hooks?.postTool(def.name, input, success);
	emitTodosIfNeeded(def, finalResult, emit, success);
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
	memory?: string;
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
	if (input.memory?.trim()) parts.push("## Memory", input.memory.trim());
	if (input.skillCatalog?.trim()) parts.push(input.skillCatalog.trim());
	return parts.join("\n\n");
}

export function defaultSummarizer(provider: MainModelProvider): SummarizerFn {
	return async ({ messages }) => {
		const text = messages
			.filter(isModelContextMessage)
			.map((m) => {
				if (m.kind === "turn") return `${m.role}: ${m.content}`;
				if (m.kind === "system") return `system: ${m.text}`;
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
