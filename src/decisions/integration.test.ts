import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config.ts";
import { createExecApprovalGate } from "../core/approval.ts";
import type { AgentEvent, MainModelProvider } from "../core/events.ts";
import { textResult, UNKNOWN_TOOL_ANNOTATIONS } from "../core/mcp.ts";
import { type RunTurnDeps, runTurn } from "../core/run-turn.ts";
import { createMemorySessionStore } from "../core/session.ts";
import type { ConstructAgent } from "../core/strands.ts";
import { noopObservability } from "../observability/noop.ts";
import { createHarness } from "../runtime.ts";
import { DEFAULT_JEV_MODEL, type FetchImpl } from "./client.ts";
import type { ResolvedDecisions } from "./config.ts";
import type { ShortcutPlanner } from "./shortcuts.ts";

const fakeProvider: MainModelProvider = {
	kind: "fake",
	modelId: "fake",
	async *stream() {
		yield { type: "done" };
	},
};

const resolved: ResolvedDecisions = {
	model: DEFAULT_JEV_MODEL,
	minConfidence: 0.6,
	approvalThreshold: 0.9,
	shortcuts: true,
	approvals: true,
	memory: true,
	apiKey: "sk-test",
	baseUrl: "https://openrouter.ai/api/v1",
};

function openTool(opened: string[], fail = false) {
	return {
		name: "open_url",
		description: "open",
		inputSchema: { type: "object", properties: {} },
		annotations: UNKNOWN_TOOL_ANNOTATIONS,
		async handler(input: Record<string, unknown>) {
			opened.push(String(input.url));
			return fail ? textResult("could not open", true) : textResult("ok");
		},
	};
}

function agentSpy() {
	const seen = { ran: 0, system: "" };
	const constructAgent: ConstructAgent = (input) => {
		seen.system = input.systemPrompt;
		return {
			async run(_message, emit) {
				seen.ran += 1;
				emit({ kind: "text_delta", text: "from the agent" });
			},
		};
	};
	return { seen, constructAgent };
}

function deps(
	cwd: string,
	tool: ReturnType<typeof openTool>,
	spy: ReturnType<typeof agentSpy>,
	extra: Partial<RunTurnDeps>,
): RunTurnDeps {
	return {
		cwd,
		name: "test",
		systemPrompt: "base",
		tools: [tool],
		approval: createExecApprovalGate({ policy: "auto" }),
		store: createMemorySessionStore(),
		provider: fakeProvider,
		constructAgent: spy.constructAgent,
		observability: noopObservability,
		decisions: resolved,
		...extra,
	};
}

async function collect(run: (emit: (e: AgentEvent) => void) => Promise<unknown>) {
	const events: AgentEvent[] = [];
	await run((e) => events.push(e));
	return events;
}

describe("shortcut seam", () => {
	const plan: ShortcutPlanner = async ({ message }) =>
		message.startsWith("open ")
			? { toolName: "open_url", input: { url: message.slice(5) }, reply: "Opened it." }
			: undefined;

	test("answers with one tool call and never calls the agent", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "shortcut-"));
		try {
			const opened: string[] = [];
			const spy = agentSpy();
			const d = deps(cwd, openTool(opened), spy, { shortcut: plan });
			const events = await collect((emit) => runTurn(d, { message: "open https://a.dev" }, emit));
			expect(opened).toEqual(["https://a.dev"]);
			expect(spy.seen.ran).toBe(0);
			const kinds = events.map((e) => e.kind);
			expect(kinds).toContain("tool_call_start");
			expect(kinds).toContain("tool_call_end");
			expect(events.find((e) => e.kind === "text_delta")).toMatchObject({ text: "Opened it." });
			expect(kinds.at(-1)).toBe("completion");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("saves the reply into the session", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "shortcut-"));
		try {
			const spy = agentSpy();
			const d = deps(cwd, openTool([]), spy, { shortcut: plan });
			const session = await runTurn(d, { message: "open https://a.dev" }, () => undefined);
			const roles = session?.messages.map((m) => (m.kind === "turn" ? m.role : m.kind));
			expect(roles?.filter((r) => r !== "system")).toEqual(["user", "tool", "assistant"]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("a storage failure after a shortcut ends the turn with an error, not a rejection", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "shortcut-"));
		try {
			const spy = agentSpy();
			const real = createMemorySessionStore();
			let appends = 0;
			const store: typeof real = {
				...real,
				async append(session, message) {
					// Let the user turn and tool row save; fail on the final assistant reply.
					if (message.kind === "turn" && message.role === "assistant") {
						appends += 1;
						throw new Error("disk full");
					}
					return real.append(session, message);
				},
			};
			const d = deps(cwd, openTool([]), spy, { shortcut: plan, store });
			const events: AgentEvent[] = [];
			const session = await runTurn(d, { message: "open https://a.dev" }, (e) => events.push(e));
			expect(appends).toBe(1);
			expect(session).toBeDefined();
			expect(spy.seen.ran).toBe(0);
			const last = events.at(-1);
			expect(last).toMatchObject({ kind: "error", message: "disk full" });
			expect(events.some((e) => e.kind === "completion")).toBe(false);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("falls through to the agent when the planner passes", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "shortcut-"));
		try {
			const opened: string[] = [];
			const spy = agentSpy();
			const d = deps(cwd, openTool(opened), spy, { shortcut: plan });
			await collect((emit) => runTurn(d, { message: "explain closures" }, emit));
			expect(spy.seen.ran).toBe(1);
			expect(opened).toEqual([]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("falls through when the tool fails, throws, or is missing", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "shortcut-"));
		try {
			const cases: Array<[string, ShortcutPlanner, boolean]> = [
				["tool error", plan, true],
				[
					"planner throws",
					async () => {
						throw new Error("boom");
					},
					false,
				],
				["unknown tool", async () => ({ toolName: "nope", input: {}, reply: "x" }), false],
			];
			for (const [, planner, failTool] of cases) {
				const spy = agentSpy();
				const d = deps(cwd, openTool([], failTool), spy, { shortcut: planner });
				await collect((emit) => runTurn(d, { message: "open https://a.dev" }, emit));
				expect(spy.seen.ran).toBe(1);
			}
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("continueWithAgent runs the tool, then the agent with the note", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "shortcut-"));
		try {
			const opened: string[] = [];
			const spy = agentSpy();
			const d = deps(cwd, openTool(opened), spy, {
				shortcut: async () => ({
					toolName: "open_url",
					input: { url: "https://a.dev" },
					reply: "",
					continueWithAgent: true,
					agentNote: "The site is already open.",
				}),
			});
			await collect((emit) => runTurn(d, { message: "open a.dev and read it" }, emit));
			expect(opened).toEqual(["https://a.dev"]);
			expect(spy.seen.ran).toBe(1);
			expect(spy.seen.system).toContain("The site is already open.");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("is skipped when decisions are off, shortcuts are off, or the turn is an edit", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "shortcut-"));
		try {
			for (const extra of [
				{ decisions: undefined },
				{ decisions: { ...resolved, shortcuts: false } },
			] as Array<Partial<RunTurnDeps>>) {
				const opened: string[] = [];
				const spy = agentSpy();
				const d = deps(cwd, openTool(opened), spy, { shortcut: plan, ...extra });
				await collect((emit) => runTurn(d, { message: "open https://a.dev" }, emit));
				expect(opened).toEqual([]);
				expect(spy.seen.ran).toBe(1);
			}
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("the shortcut tool call still goes through approval", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "shortcut-"));
		try {
			let asked = 0;
			const exec = {
				...openTool([]),
				name: "exec",
				async handler() {
					return textResult("ran");
				},
			};
			const spy = agentSpy();
			const d = deps(cwd, exec, spy, {
				approval: createExecApprovalGate({
					policy: "prompt",
					ask: async () => {
						asked += 1;
						return false;
					},
				}),
				shortcut: async () => ({ toolName: "exec", input: { command: "ls" }, reply: "done" }),
			});
			await collect((emit) => runTurn(d, { message: "list files" }, emit));
			expect(asked).toBe(1);
			expect(spy.seen.ran).toBe(1);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});

describe("runtime wiring", () => {
	let home = "";
	const prevHome = process.env.HARNESS_HOME;
	beforeAll(async () => {
		home = await mkdtemp(join(tmpdir(), "rt-dec-home-"));
		process.env.HARNESS_HOME = home;
	});
	afterAll(async () => {
		if (prevHome === undefined) delete process.env.HARNESS_HOME;
		else process.env.HARNESS_HOME = prevHome;
		await rm(home, { recursive: true, force: true });
	});

	const noulFetch = (value: number) => {
		let calls = 0;
		const impl: FetchImpl = async (_url, init) => {
			calls += 1;
			const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
			const key = Object.keys(body.questions)[0] ?? "";
			return new Response(JSON.stringify({ answers: { [key]: { noul: value } } }));
		};
		return { impl, count: () => calls };
	};

	test("an injected test provider keeps decisions off, so no network", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "rt-dec-"));
		try {
			const { impl, count } = noulFetch(0.99);
			let approvalRan = 0;
			const harness = await createHarness({
				cwd,
				config: DEFAULT_CONFIG,
				provider: fakeProvider,
				decisionsFetch: impl,
				constructAgent: (input) => ({
					async run() {
						const exec = input.tools.find((t) => t.name === "exec");
						await exec?.invoke({ command: "echo hi" });
						approvalRan += 1;
					},
				}),
				observability: noopObservability,
			});
			process.env.OPENROUTER_API_KEY = "sk-test";
			await harness.runTurn("say hi", () => undefined, { approvalAsk: async () => false });
			expect(approvalRan).toBe(1);
			expect(count()).toBe(0);
			harness.close();
		} finally {
			delete process.env.OPENROUTER_API_KEY;
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("with decisions on, a clearly safe exec skips the prompt", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "rt-dec-"));
		try {
			const { impl, count } = noulFetch(0.97);
			let asked = 0;
			const events: AgentEvent[] = [];
			const harness = await createHarness({
				cwd,
				config: DEFAULT_CONFIG,
				provider: fakeProvider,
				decisions: true,
				decisionsFetch: impl,
				constructAgent: (input) => ({
					async run() {
						await input.tools.find((t) => t.name === "exec")?.invoke({ command: "echo hi" });
					},
				}),
				observability: noopObservability,
			});
			harness.setApiKey("sk-test");
			await harness.runTurn("run echo hi", (e) => events.push(e), {
				approvalAsk: async () => {
					asked += 1;
					return false;
				},
			});
			expect(count()).toBe(1);
			expect(asked).toBe(0);
			expect(events.some((e) => e.kind === "approval_request")).toBe(false);
			harness.close();
		} finally {
			delete process.env.OPENROUTER_API_KEY;
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("with decisions on, an unsure score still asks the user", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "rt-dec-"));
		try {
			const { impl } = noulFetch(0.4);
			let asked = 0;
			const harness = await createHarness({
				cwd,
				config: DEFAULT_CONFIG,
				provider: fakeProvider,
				decisions: true,
				decisionsFetch: impl,
				constructAgent: (input) => ({
					async run() {
						await input.tools.find((t) => t.name === "exec")?.invoke({ command: "echo hi" });
					},
				}),
				observability: noopObservability,
			});
			harness.setApiKey("sk-test");
			await harness.runTurn("run echo hi", () => undefined, {
				approvalAsk: async () => {
					asked += 1;
					return false;
				},
			});
			expect(asked).toBe(1);
			harness.close();
		} finally {
			delete process.env.OPENROUTER_API_KEY;
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("config can turn decisions off even with a key", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "rt-dec-"));
		try {
			const { impl, count } = noulFetch(0.99);
			let asked = 0;
			const harness = await createHarness({
				cwd,
				config: { ...DEFAULT_CONFIG, decisions: { enabled: false } },
				provider: fakeProvider,
				decisions: true,
				decisionsFetch: impl,
				constructAgent: (input) => ({
					async run() {
						await input.tools.find((t) => t.name === "exec")?.invoke({ command: "echo hi" });
					},
				}),
				observability: noopObservability,
			});
			harness.setApiKey("sk-test");
			await harness.runTurn("run echo hi", () => undefined, {
				approvalAsk: async () => {
					asked += 1;
					return false;
				},
			});
			expect(count()).toBe(0);
			expect(asked).toBe(1);
			harness.close();
		} finally {
			delete process.env.OPENROUTER_API_KEY;
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("memory: a turn with nothing durable skips the extraction call", async () => {
		const { writeMemoryPrefs } = await import("../memory/prefs.ts");
		writeMemoryPrefs({ enabled: true });
		for (const [score, expectedStreams] of [
			[0.01, 0],
			[0.8, 1],
		] as const) {
			const cwd = await mkdtemp(join(tmpdir(), "rt-dec-"));
			try {
				const { impl } = noulFetch(score);
				let extractCalls = 0;
				const provider: MainModelProvider = {
					kind: "fake",
					modelId: "fake",
					async *stream() {
						extractCalls += 1;
						yield { type: "text_delta", text: "[]" };
						yield { type: "done" };
					},
				};
				const harness = await createHarness({
					cwd,
					config: { ...DEFAULT_CONFIG, decisions: { approvals: false } },
					provider,
					decisions: true,
					decisionsFetch: impl,
					constructAgent: () => ({
						async run(_m, emit) {
							emit({ kind: "text_delta", text: "ok" });
						},
					}),
					observability: noopObservability,
				});
				harness.setApiKey("sk-test");
				await harness.runTurn("I always prefer bun over npm", () => undefined);
				await Bun.sleep(80);
				expect(extractCalls).toBe(expectedStreams);
				harness.close();
			} finally {
				await rm(cwd, { recursive: true, force: true });
			}
		}
		delete process.env.OPENROUTER_API_KEY;
	});
});
