import type { ModelRole } from "../cli/defaults.ts";
import type { AgentEventEmitter, MainModelProvider, ProviderStreamEvent } from "../core/events.ts";
import { newId } from "../core/ids.ts";
import { appendDebugTurn } from "./browser/debug-log.ts";
import { parseBrowserActions } from "./browser/parse-actions.ts";
import { repeatDecision, repeatKey, writeSiteNote } from "./browser/repeat.ts";
import { wantsNewDocument } from "./compose.ts";
import { computerSystemPrompt } from "./prompt.ts";
import { forSpeech } from "./speech-safe.ts";
import { appendRunLog, type TurnTelemetry } from "./telemetry.ts";
import { COMPUTER_TOOL_SCHEMAS, type ComputerRuntime } from "./tools.ts";

const TURN_CAP = 8;

export type ComputerTier = 1 | 2;

export interface ComputerLoopResult {
	summary: string;
	success: boolean;
	turns: number;
	tier: ComputerTier;
	finishedBy: "router" | "tier1" | "tier2" | "cap";
}

export async function runComputerLoop(input: {
	task: string;
	tier: ComputerTier;
	provider: MainModelProvider;
	writer?: MainModelProvider;
	role?: ModelRole;
	runtime: ComputerRuntime;
	signal?: AbortSignal;
	emit?: AgentEventEmitter;
	runId?: string;
	seed?: string;
}): Promise<ComputerLoopResult> {
	const emit = input.emit ?? (() => undefined);
	const tools = COMPUTER_TOOL_SCHEMAS.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema as Record<string, unknown>,
	}));
	const history: Array<{ role: "user" | "assistant"; content: string }> = [
		{ role: "user", content: input.task },
	];
	if (input.seed) {
		history.push({
			role: "user",
			content: input.seed,
		});
	}
	let tier = input.tier;
	let provider = input.provider;
	let role: ModelRole = input.role ?? (tier === 2 ? "writer" : "navigator");
	let turns = 0;
	let lastFail = "";
	let failCount = 0;
	let didAct = false;
	let wroteText = false;
	const repeats = new Map<string, number>();
	let continuation = 0;

	const escalateToWriter = (reason: string) => {
		if (tier === 2 || !input.writer) return;
		tier = 2;
		provider = input.writer;
		role = "writer";
		lastFail = reason;
	};

	while (continuation < 3) {
		while (turns < TURN_CAP) {
			if (input.signal?.aborted) {
				return { summary: "Cancelled.", success: false, turns, tier, finishedBy: "cap" };
			}
			turns += 1;
			const started = Date.now();
			const events: ProviderStreamEvent[] = [];
			for await (const event of provider.stream(
				{
					system: computerSystemPrompt(),
					messages: history,
					tools,
				},
				{ signal: input.signal },
			)) {
				events.push(event);
				if (event.type === "tool_call") {
					emit({
						kind: "tool_call_start",
						toolName: event.name,
						callId: event.id,
						input: event.input,
					});
				}
			}

			const calls = events.filter((event) => event.type === "tool_call");
			const usage = provider.takeUsage?.();
			const telemetry: TurnTelemetry = {
				at: new Date().toISOString(),
				turn: turns,
				tier,
				llmMs: Date.now() - started,
				actions: 0,
				tokensIn: usage?.promptTokens,
				tokensOut: usage?.completionTokens,
				role,
				model: provider.modelId,
				ladder: "ui",
			};

			if (calls.length === 0) {
				history.push({
					role: "user",
					content:
						"Use observe and act. Do not claim you clicked or typed. The screen has not changed.",
				});
				appendRunLog(input.runId, telemetry);
				continue;
			}

			let observation = "";
			for (const call of calls) {
				if (call.type !== "tool_call") continue;
				const callId = call.id || newId("act");
				try {
					if (call.name === "done") {
						if (!didAct) {
							emit({
								kind: "tool_call_end",
								toolName: "done",
								callId,
								success: false,
								error: "No screen action yet.",
							});
							history.push({
								role: "user",
								content:
									"You have not acted on the screen. Call observe, then act (click/type) before done.",
							});
							continue;
						}
						if (taskNeedsTypedText(input.task) && !wroteText) {
							emit({
								kind: "tool_call_end",
								toolName: "done",
								callId,
								success: false,
								error: "Text was not typed.",
							});
							history.push({
								role: "user",
								content:
									"Nothing was typed. Observe the page and type into the field. Do not say the text is entered until the act result shows it.",
							});
							continue;
						}
						const summary = forSpeech(String(call.input.summary ?? "Done.")) ?? "Done.";
						const success = call.input.success !== false;
						emit({ kind: "tool_call_end", toolName: "done", callId, success: true });
						appendRunLog(input.runId, telemetry);
						return {
							summary,
							success,
							turns,
							tier,
							finishedBy: tier === 2 ? "tier2" : "tier1",
						};
					}
					if (call.name === "observe") {
						const mode =
							call.input.mode === "native" || call.input.mode === "screenshot"
								? call.input.mode
								: "browser";
						observation = await input.runtime.observe(mode, asString(call.input.app));
						telemetry.actions += 1;
					} else if (call.name === "act") {
						const parsed = parseBrowserActions(call.input.actions);
						if (parsed.error) {
							observation = parsed.error;
							failCount += 1;
							lastFail = parsed.error;
						} else {
							const actions = parsed.actions;
							const repeated = actions
								.map((action) => repeatKey(action))
								.filter((key): key is string => Boolean(key))
								.map((key) => repeatDecision(repeats, key));
							if (repeated.includes("ask")) {
								observation = await input.runtime.askUser(
									"The same page action keeps repeating. What should I do next?",
								);
							} else if (repeated.includes("escalate")) {
								escalateToWriter("repeat");
								observation =
									"You already did this. Continue from the state below. A larger model will take the next step.";
							} else if (repeated.includes("skip")) {
								observation = `You already did this. Continue from the state below.\n${observation}`;
							} else {
								telemetry.actions += actions.length;
								const result = await input.runtime.act(actions);
								observation = result.observation;
								if (actions.length > 0 && !result.stopped) didAct = true;
								if (
									!result.stopped &&
									actions.some(
										(action) =>
											(action.kind === "type" || action.kind === "select") &&
											typeof action.text === "string" &&
											action.text.length > 0,
									)
								) {
									wroteText = true;
								}
								if (result.stopped === "stop") {
									appendRunLog(input.runId, telemetry);
									return {
										summary: "Stopped.",
										success: false,
										turns,
										tier,
										finishedBy: "cap",
									};
								}
								if (result.stopped) {
									failCount += 1;
									lastFail = result.stopped;
									if (failCount >= 2 || needsWriter(observation, input.task)) {
										escalateToWriter(lastFail || "screen");
									}
								} else {
									failCount = 0;
									if (needsWriter(observation, input.task)) escalateToWriter("screen");
								}
							}
						}
					} else if (call.name === "remember_site") {
						const note = String(call.input.note ?? call.input.text ?? "");
						writeSiteNote(observation || input.task, note);
						observation = "Saved a note for this site.";
					} else if (call.name === "run") {
						observation = await input.runtime.run(
							String(call.input.tool ?? ""),
							String(call.input.arg ?? ""),
						);
						if (observation === "STOP_TASK") {
							appendRunLog(input.runId, telemetry);
							return {
								summary: "Stopped.",
								success: false,
								turns,
								tier,
								finishedBy: "cap",
							};
						}
						telemetry.actions += 1;
					} else if (call.name === "ask_user") {
						observation = await input.runtime.askUser(String(call.input.question ?? ""));
					} else {
						observation = `Unknown tool ${call.name}.`;
					}
					appendDebugTurn(input.runId, {
						at: new Date().toISOString(),
						turn: turns,
						tool: call.name,
						observation: observation.slice(0, 8_000),
						input: call.input,
					});
					emit({
						kind: "tool_call_end",
						toolName: call.name,
						callId,
						success: true,
						output: observation.slice(0, 4_000),
					});
					history.push({
						role: "assistant",
						content: `${call.name}(${JSON.stringify(call.input)})`,
					});
					history.push({ role: "user", content: observation.slice(0, 12_000) });
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					failCount += 1;
					lastFail = message;
					emit({
						kind: "tool_call_end",
						toolName: call.name,
						callId,
						success: false,
						error: message,
					});
					history.push({ role: "user", content: `Error: ${message}` });
					if (failCount >= 2) escalateToWriter(message);
				}
			}
			appendRunLog(input.runId, { ...telemetry, lastFail });
		}
		if (wroteText || !taskNeedsTypedText(input.task)) break;
		continuation += 1;
		turns = 0;
		history.push({
			role: "user",
			content: wantsNewDocument(input.task)
				? "Continue the task. Create a new page from a control on the page, then type there. Do not use the address bar."
				: "Continue the task. Type into the field for what they asked. Do not switch to a different task.",
		});
	}

	return {
		summary: wroteText ? "It's in the composer." : "I didn't finish that.",
		success: wroteText,
		turns,
		tier,
		finishedBy: "cap",
	};
}

function taskNeedsTypedText(task: string): boolean {
	return /\b(type|write|draft|enter|fill|paste|post|tweet|compose|publish)\b/i.test(task);
}

function needsWriter(observation: string, task: string): boolean {
	if (/\b(modal|dialog|sheet|canvas)\b/i.test(observation)) return true;
	if (task.length > 500) return true;
	return observation.length > 3_000;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
