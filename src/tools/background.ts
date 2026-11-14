import type { AgentEventEmitter } from "../core/events.ts";
import {
	errorResult,
	jsonResult,
	type McpToolDefinition,
	READ_ONLY_ANNOTATIONS,
} from "../core/mcp.ts";
import { type Skill, skillBodiesForNames } from "../skills/loader.ts";

/** explore = read-only search and report. general = the full tool set. */
export type SubagentKind = "explore" | "general";

export type BackgroundAgentStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface BackgroundAgentSnapshot {
	id: string;
	label: string;
	kind: SubagentKind;
	status: BackgroundAgentStatus;
	elapsedMs: number;
	result?: string;
	error?: string;
}

export interface BackgroundAgentRunInput {
	prompt: string;
	label: string;
	kind: SubagentKind;
	extraSystem: string;
	emit: AgentEventEmitter;
	signal: AbortSignal;
}

export interface BackgroundAgentsOptions {
	/** Run one nested turn. Its tools must not include the tools made here. */
	run: (input: BackgroundAgentRunInput) => Promise<void>;
	/** The parent turn's emitter, for nested tool cards and approvals. */
	parentEmit: () => AgentEventEmitter;
	skills?: Skill[];
	/** Kinds the model may spawn. Defaults to both. */
	kinds?: readonly SubagentKind[];
	/** Agents running at once. The rest wait in a queue. Default 4. */
	maxConcurrent?: number;
	/** Agents one registry will ever start. Default 12. */
	maxAgents?: number;
	/** The parent turn's signal. Aborting it cancels every agent. */
	signal?: AbortSignal;
}

export interface BackgroundAgents {
	/** spawn_agent, await_agents and cancel_agent. */
	tools: McpToolDefinition[];
	/**
	 * Wrap one of the parent's other tools so its result also says which background agents have
	 * finished since the model last heard. This is how the model learns of a result without polling.
	 */
	withNotices(tool: McpToolDefinition): McpToolDefinition;
	snapshot(): BackgroundAgentSnapshot[];
	/** Agents that are queued or running. */
	pending(): number;
	/** Cancel what is left and drop later events. Call when the parent turn ends. */
	close(reason?: string): void;
}

export const DEFAULT_BACKGROUND_MAX_CONCURRENT = 4;
export const DEFAULT_BACKGROUND_MAX_AGENTS = 12;
const DEFAULT_AWAIT_SECONDS = 120;
const MAX_AWAIT_SECONDS = 600;
const MAX_RESULT_CHARS = 24_000;

export const EXPLORE_INSTRUCTIONS = [
	"You are a read-only explorer subagent. Search and read to answer the task, then reply with a short report.",
	"Send independent searches and reads in the same step so they run in parallel.",
	"Report what you found with file paths and line numbers. Quote only the lines that matter; do not paste whole files.",
	"Say plainly what you could not find. Do not edit anything, do not ask the user questions, do not spawn further subagents.",
].join(" ");

export const BACKGROUND_AGENTS_PROMPT = [
	"## Background agents",
	"spawn_agent starts a subagent and returns its id at once, so you can keep working while it runs.",
	"For a broad search or several independent questions, spawn one explore agent per question in the same step, carry on with what you can do yourself, then call await_agents to read the reports.",
	"Explore agents are read-only and fast. Give each a complete, self-contained prompt: it does not see this conversation.",
	"Do not spawn an agent for something one grep or one file read answers.",
].join("\n");

interface Entry {
	id: string;
	label: string;
	kind: SubagentKind;
	status: BackgroundAgentStatus;
	startedAt: number;
	endedAt?: number;
	text: string;
	error?: string;
	controller: AbortController;
	settled: Promise<void>;
	settle: () => void;
	start: () => void;
	/** The model has been told this agent finished, or has read its result. */
	announced: boolean;
}

function isFinished(status: BackgroundAgentStatus): boolean {
	return status === "done" || status === "failed" || status === "cancelled";
}

function clip(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length <= MAX_RESULT_CHARS) return trimmed;
	return `${trimmed.slice(0, MAX_RESULT_CHARS)}\n… (report cut at ${MAX_RESULT_CHARS} characters)`;
}

export function createBackgroundAgents(options: BackgroundAgentsOptions): BackgroundAgents {
	const kinds: readonly SubagentKind[] = options.kinds?.length
		? options.kinds
		: ["explore", "general"];
	const defaultKind: SubagentKind = kinds.includes("explore") ? "explore" : (kinds[0] ?? "general");
	const maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULT_BACKGROUND_MAX_CONCURRENT);
	const maxAgents = Math.max(1, options.maxAgents ?? DEFAULT_BACKGROUND_MAX_AGENTS);
	const entries = new Map<string, Entry>();
	const queue: Entry[] = [];
	let running = 0;
	let closed = false;
	let counter = 0;

	const snapshotOf = (entry: Entry): BackgroundAgentSnapshot => ({
		id: entry.id,
		label: entry.label,
		kind: entry.kind,
		status: entry.status,
		elapsedMs: (entry.endedAt ?? Date.now()) - entry.startedAt,
		...(isFinished(entry.status) && entry.status !== "cancelled"
			? { result: clip(entry.text) || "(the agent produced no text)" }
			: {}),
		...(entry.error ? { error: entry.error } : {}),
	});

	const finish = (entry: Entry, status: BackgroundAgentStatus, error?: string): void => {
		if (isFinished(entry.status)) return;
		entry.status = status;
		entry.endedAt = Date.now();
		if (error) entry.error = error;
		entry.settle();
	};

	const pump = (): void => {
		while (running < maxConcurrent) {
			const next = queue.shift();
			if (!next) return;
			if (next.status !== "queued") continue;
			next.start();
		}
	};

	const cancel = (entry: Entry, reason: string): void => {
		if (isFinished(entry.status)) return;
		const wasQueued = entry.status === "queued";
		finish(entry, "cancelled", reason);
		if (!wasQueued) entry.controller.abort();
	};

	const close = (reason = "The turn ended before this agent finished."): void => {
		if (closed) return;
		closed = true;
		for (const entry of entries.values()) cancel(entry, reason);
		queue.length = 0;
	};

	if (options.signal) {
		if (options.signal.aborted) close("The turn was stopped.");
		else
			options.signal.addEventListener("abort", () => close("The turn was stopped."), {
				once: true,
			});
	}

	const spawn = (input: {
		prompt: string;
		label: string;
		kind: SubagentKind;
		extraSystem: string;
	}): Entry => {
		counter += 1;
		let settle: () => void = () => undefined;
		const settled = new Promise<void>((resolve) => {
			settle = resolve;
		});
		const entry: Entry = {
			id: `bg_${counter}`,
			label: input.label,
			kind: input.kind,
			status: "queued",
			startedAt: Date.now(),
			text: "",
			controller: new AbortController(),
			settled,
			settle,
			start: () => undefined,
			announced: false,
		};
		const emit: AgentEventEmitter = (event) => {
			if (event.kind === "text_delta") {
				entry.text += event.text;
				return;
			}
			if (event.kind === "error") {
				entry.error = event.message;
				return;
			}
			if (closed || isFinished(entry.status)) return;
			// The parent's own stream carries the rest. A nested error or completion would end it.
			if (
				event.kind === "tool_call_start" ||
				event.kind === "tool_call_end" ||
				event.kind === "approval_request" ||
				event.kind === "usage"
			) {
				options.parentEmit()(event);
			}
		};
		entry.start = () => {
			running += 1;
			entry.status = "running";
			entry.startedAt = Date.now();
			void (async () => {
				try {
					await options.run({
						prompt: input.prompt,
						label: input.label,
						kind: input.kind,
						extraSystem: input.extraSystem,
						emit,
						signal: entry.controller.signal,
					});
					if (entry.error) finish(entry, "failed", entry.error);
					else finish(entry, "done");
				} catch (err) {
					finish(entry, "failed", err instanceof Error ? err.message : String(err));
				} finally {
					running -= 1;
					pump();
				}
			})();
		};
		entries.set(entry.id, entry);
		queue.push(entry);
		pump();
		return entry;
	};

	const waitFor = async (targets: Entry[], timeoutMs: number): Promise<void> => {
		const open = targets.filter((entry) => !isFinished(entry.status));
		if (open.length === 0) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, timeoutMs);
		});
		try {
			await Promise.race([Promise.all(open.map((entry) => entry.settled)), timeout]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	};

	const takeNotices = (): BackgroundAgentSnapshot[] => {
		const done: BackgroundAgentSnapshot[] = [];
		for (const entry of entries.values()) {
			if (entry.announced || !isFinished(entry.status)) continue;
			entry.announced = true;
			done.push(snapshotOf(entry));
		}
		return done;
	};

	const spawnTool: McpToolDefinition = {
		name: "spawn_agent",
		description:
			"Start a subagent in the background and return its id at once. You keep working while it runs. " +
			"Use kind explore (read-only, fast) for search and research; spawn several in one step for independent questions. " +
			"Pass a complete prompt: the agent does not see this conversation. Read the report with await_agents.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		inputSchema: {
			type: "object",
			properties: {
				prompt: { type: "string", description: "The full task for the agent." },
				label: { type: "string", description: "Short name shown in the transcript." },
				kind: {
					type: "string",
					enum: [...kinds],
					description: `explore = read-only search and report. general = full tools. Default ${defaultKind}.`,
				},
				skills: {
					type: "array",
					items: { type: "string" },
					description: "Skill names to load into the agent's system prompt.",
				},
			},
			required: ["prompt"],
		},
		async handler(raw) {
			if (closed) return errorResult("This turn is over; no agent was started.");
			const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
			if (!prompt) return errorResult("prompt is empty");
			if (entries.size >= maxAgents) {
				return errorResult(
					`This turn already started ${maxAgents} background agents. Read their reports with await_agents.`,
				);
			}
			const requested = raw.kind === "general" || raw.kind === "explore" ? raw.kind : defaultKind;
			if (!kinds.includes(requested)) {
				return errorResult(`kind ${requested} is not available here. Use ${kinds.join(" or ")}.`);
			}
			const label =
				typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : requested;
			const names = Array.isArray(raw.skills)
				? raw.skills.filter((s): s is string => typeof s === "string")
				: [];
			const extraSystem = options.skills ? skillBodiesForNames(options.skills, names) : "";
			const entry = spawn({ prompt, label, kind: requested, extraSystem });
			return jsonResult({ id: entry.id, label, kind: requested, status: entry.status });
		},
	};

	const awaitTool: McpToolDefinition = {
		name: "await_agents",
		description:
			"Wait for background agents and return their reports. With no ids it waits for every agent started this turn. " +
			"An agent still running when the wait ends comes back with status running; call again to keep waiting.",
		annotations: READ_ONLY_ANNOTATIONS,
		inputSchema: {
			type: "object",
			properties: {
				ids: {
					type: "array",
					items: { type: "string" },
					description: "Agent ids from spawn_agent. Omit for all.",
				},
				timeout_seconds: {
					type: "number",
					description: `How long to wait (default ${DEFAULT_AWAIT_SECONDS}, max ${MAX_AWAIT_SECONDS}). 0 returns the current state without waiting.`,
				},
			},
		},
		async handler(raw) {
			const ids = Array.isArray(raw.ids)
				? raw.ids.filter((id): id is string => typeof id === "string")
				: [];
			const unknown = ids.filter((id) => !entries.has(id));
			if (unknown.length > 0) return errorResult(`No background agent ${unknown.join(", ")}.`);
			const targets =
				ids.length > 0
					? ids.map((id) => entries.get(id)).filter((entry): entry is Entry => Boolean(entry))
					: [...entries.values()];
			if (targets.length === 0) return errorResult("No background agents were started this turn.");
			const seconds =
				typeof raw.timeout_seconds === "number" && Number.isFinite(raw.timeout_seconds)
					? Math.min(Math.max(raw.timeout_seconds, 0), MAX_AWAIT_SECONDS)
					: DEFAULT_AWAIT_SECONDS;
			if (seconds > 0) await waitFor(targets, seconds * 1000);
			for (const entry of targets) {
				if (isFinished(entry.status)) entry.announced = true;
			}
			return jsonResult({ agents: targets.map(snapshotOf) });
		},
	};

	const cancelTool: McpToolDefinition = {
		name: "cancel_agent",
		description: "Stop a background agent whose result is no longer needed.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "Agent id from spawn_agent." } },
			required: ["id"],
		},
		async handler(raw) {
			const id = typeof raw.id === "string" ? raw.id.trim() : "";
			const entry = entries.get(id);
			if (!entry) return errorResult(`No background agent ${id || "(empty id)"}.`);
			cancel(entry, "Cancelled by the agent.");
			entry.announced = true;
			pump();
			return jsonResult({ id: entry.id, status: entry.status });
		},
	};

	return {
		tools: [spawnTool, awaitTool, cancelTool],
		withNotices(tool) {
			return {
				...tool,
				async handler(input) {
					const result = await tool.handler(input);
					const done = takeNotices();
					if (done.length === 0) return result;
					const names = done.map((agent) => `${agent.id} (${agent.label}, ${agent.status})`);
					const note = `[background agents] finished: ${names.join(", ")}. Call await_agents to read the reports.`;
					return {
						...result,
						content: [...result.content, { type: "text" as const, text: note }],
						...(result.structuredContent
							? {
									structuredContent: {
										...result.structuredContent,
										background_agents_finished: done.map((agent) => agent.id),
									},
								}
							: {}),
					};
				},
			};
		},
		snapshot: () => [...entries.values()].map(snapshotOf),
		pending: () => [...entries.values()].filter((entry) => !isFinished(entry.status)).length,
		close,
	};
}

/** The tools an explore agent may use: the ones that declare themselves read-only. */
export function readOnlyTools(tools: McpToolDefinition[]): McpToolDefinition[] {
	return tools.filter((tool) => tool.annotations.readOnlyHint);
}
