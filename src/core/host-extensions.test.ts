import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config.ts";
import { noopObservability } from "../observability/noop.ts";
import { createHarness } from "../runtime.ts";
import { createExecApprovalGate } from "./approval.ts";
import type { AgentEvent, MainModelProvider } from "./events.ts";
import { textResult, UNKNOWN_TOOL_ANNOTATIONS } from "./mcp.ts";
import { type RunTurnDeps, runTurn, type TurnInterceptor } from "./run-turn.ts";
import { createFileSessionStore, createMemorySessionStore } from "./session.ts";
import type { ConstructAgent } from "./strands.ts";

const provider: MainModelProvider = {
	kind: "fake",
	modelId: "fake",
	async *stream() {
		yield { type: "done" };
	},
};

function tool(name: string) {
	return {
		name,
		description: name,
		inputSchema: { type: "object", properties: {} },
		annotations: UNKNOWN_TOOL_ANNOTATIONS,
		async handler() {
			return textResult("ok");
		},
	};
}

function spy() {
	const seen = { ran: 0, system: "", tools: [] as string[], message: "" };
	const constructAgent: ConstructAgent = (input) => {
		seen.system = input.systemPrompt;
		seen.tools = input.tools.map((t) => t.name);
		return {
			async run(message, emit) {
				seen.ran += 1;
				seen.message = message;
				emit({ kind: "text_delta", text: "agent answer" });
			},
		};
	};
	return { seen, constructAgent };
}

function deps(extra: Partial<RunTurnDeps> & { constructAgent: ConstructAgent }): RunTurnDeps {
	return {
		cwd: "/tmp",
		name: "test",
		systemPrompt: "base",
		tools: [tool("read_file"), tool("open_search")],
		approval: createExecApprovalGate({ policy: "auto" }),
		store: createMemorySessionStore(),
		provider,
		observability: noopObservability,
		...extra,
	};
}

function texts(events: AgentEvent[]): string {
	return events
		.filter((e) => e.kind === "text_delta")
		.map((e) => (e as { text: string }).text)
		.join("");
}

describe("displayMessage", () => {
	test("the model sees the message and the transcript stores the display text", async () => {
		const s = spy();
		// The file store is what users get. Its new sessions start as "New chat" and take a real title.
		const cwd = await mkdtemp(join(tmpdir(), "display-msg-"));
		try {
			const d = deps({ constructAgent: s.constructAgent, store: createFileSessionStore(cwd) });
			const session = await runTurn(
				d,
				{ message: "[Mode banner]\n\nopen my notes", displayMessage: "open my notes" },
				() => undefined,
			);
			expect(s.seen.message).toBe("[Mode banner]\n\nopen my notes");
			const user = session?.messages.find((m) => m.kind === "turn" && m.role === "user");
			expect(user && "content" in user ? user.content : "").toBe("open my notes");
			expect(session?.title).toBe("open my notes");
			expect(JSON.stringify(session)).not.toContain("Mode banner");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("without it the message is stored as before", async () => {
		const s = spy();
		const session = await runTurn(
			deps({ constructAgent: s.constructAgent }),
			{ message: "hello" },
			() => undefined,
		);
		const user = session?.messages.find((m) => m.kind === "turn" && m.role === "user");
		expect(user && "content" in user ? user.content : "").toBe("hello");
	});
});

describe("systemAppend and excludeTools", () => {
	test("apply to one turn only", async () => {
		const s = spy();
		const d = deps({ constructAgent: s.constructAgent });
		await runTurn(
			d,
			{ message: "hi", systemAppend: "Speak plainly.", excludeTools: ["open_search"] },
			() => undefined,
		);
		expect(s.seen.system).toContain("Speak plainly.");
		expect(s.seen.tools).toEqual(["read_file"]);
		await runTurn(d, { message: "again" }, () => undefined);
		expect(s.seen.system).not.toContain("Speak plainly.");
		expect(s.seen.tools).toEqual(["read_file", "open_search"]);
	});

	test("hidden tools are not offered to an interceptor either", async () => {
		const s = spy();
		let names: string[] = [];
		const intercept: TurnInterceptor = async ({ toolNames }) => {
			names = [...toolNames];
			return undefined;
		};
		await runTurn(
			deps({ constructAgent: s.constructAgent, intercept }),
			{ message: "hi", excludeTools: ["open_search"] },
			() => undefined,
		);
		expect(names).toEqual(["read_file"]);
	});
});

describe("intercept", () => {
	test("a reply ends the turn without calling the agent", async () => {
		const s = spy();
		const events: AgentEvent[] = [];
		const session = await runTurn(
			deps({ constructAgent: s.constructAgent, intercept: async () => ({ reply: "handled" }) }),
			{ message: "do it" },
			(e) => events.push(e),
		);
		expect(s.seen.ran).toBe(0);
		expect(texts(events)).toBe("handled");
		expect(events.at(-1)?.kind).toBe("completion");
		const roles = session?.messages
			.map((m) => (m.kind === "turn" ? m.role : m.kind))
			.filter((r) => r !== "system");
		expect(roles).toEqual(["user", "assistant"]);
	});

	test("does not repeat text the interceptor already streamed", async () => {
		const s = spy();
		const events: AgentEvent[] = [];
		await runTurn(
			deps({
				constructAgent: s.constructAgent,
				intercept: async ({ emit }) => {
					emit({ kind: "text_delta", text: "streamed once" });
					return { reply: "streamed once" };
				},
			}),
			{ message: "do it" },
			(e) => events.push(e),
		);
		expect(texts(events)).toBe("streamed once");
	});

	test("returning undefined, or throwing before any output, passes to the agent", async () => {
		for (const intercept of [
			async () => undefined,
			async () => {
				throw new Error("boom");
			},
		] as TurnInterceptor[]) {
			const s = spy();
			await runTurn(
				deps({ constructAgent: s.constructAgent, intercept }),
				{ message: "x" },
				() => undefined,
			);
			expect(s.seen.ran).toBe(1);
		}
	});

	test("throwing after output ends the turn with an error and never double-answers", async () => {
		const s = spy();
		const events: AgentEvent[] = [];
		await runTurn(
			deps({
				constructAgent: s.constructAgent,
				intercept: async ({ emit }) => {
					emit({ kind: "text_delta", text: "partial work " });
					throw new Error("lost the window");
				},
			}),
			{ message: "do it" },
			(e) => events.push(e),
		);
		expect(s.seen.ran).toBe(0);
		expect(texts(events)).toBe("partial work ");
		expect(events.at(-1)).toMatchObject({ kind: "error", message: "lost the window" });
		expect(events.some((e) => e.kind === "completion")).toBe(false);
	});

	test("is skipped when editing an earlier turn", async () => {
		const s = spy();
		const store = createMemorySessionStore();
		const first = await runTurn(
			deps({ constructAgent: s.constructAgent, store }),
			{ message: "one" },
			() => undefined,
		);
		let called = 0;
		await runTurn(
			deps({
				constructAgent: s.constructAgent,
				store,
				intercept: async () => {
					called += 1;
					return { reply: "no" };
				},
			}),
			{ message: "edited", sessionId: first?.id, editUserTurn: 0 },
			() => undefined,
		);
		expect(called).toBe(0);
	});

	test("a storage failure while saving the reply is an error, not a rejection", async () => {
		const s = spy();
		const real = createMemorySessionStore();
		const store: typeof real = {
			...real,
			async append(session, message) {
				if (message.kind === "turn" && message.role === "assistant") throw new Error("disk full");
				return real.append(session, message);
			},
		};
		const events: AgentEvent[] = [];
		await runTurn(
			deps({ constructAgent: s.constructAgent, store, intercept: async () => ({ reply: "ok" }) }),
			{ message: "x" },
			(e) => events.push(e),
		);
		expect(events.at(-1)).toMatchObject({ kind: "error", message: "disk full" });
	});
});

describe("through createHarness", () => {
	test("the browser and decisions read the display text, not the host prefix", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "host-ext-"));
		try {
			const s = spy();
			let started = 0;
			const harness = await createHarness({
				cwd,
				config: DEFAULT_CONFIG,
				provider,
				constructAgent: s.constructAgent,
				observability: noopObservability,
				browserLoader: async () => {
					started += 1;
					return { tools: [], close: () => undefined };
				},
			});
			// @browser only in the host prefix: must NOT turn the browser on.
			await harness.runTurn("[Berry says @browser]\n\nhello", () => undefined, {
				displayMessage: "hello",
			});
			expect(started).toBe(0);
			// @browser in what the user typed: turns it on.
			await harness.runTurn("[banner]\n\n@browser open it", () => undefined, {
				displayMessage: "@browser open it",
			});
			expect(started).toBe(1);
			harness.close();
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("systemAppend at construction applies to every turn, and promptOnly skips other prompts", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "host-ext-"));
		try {
			let system = "";
			let asked = 0;
			const harness = await createHarness({
				cwd,
				config: DEFAULT_CONFIG,
				provider,
				systemAppend: "You are Berry.",
				constructAgent: (input) => {
					system = input.systemPrompt;
					return {
						async run() {
							await input.tools.find((t) => t.name === "exec")?.invoke({ command: "echo hi" });
							await input.tools.find((t) => t.name === "exec")?.invoke({ command: "rm -rf x" });
						},
					};
				},
				observability: noopObservability,
			});
			await harness.runTurn("go", () => undefined, {
				approvalAsk: async () => {
					asked += 1;
					return false;
				},
				promptOnly: (req) => /\brm\b/.test(String(req.input.command ?? "")),
			});
			expect(system).toContain("You are Berry.");
			expect(asked).toBe(1);
			harness.close();
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});

describe("hostData", () => {
	test("reaches the interceptor untouched, and is empty when unset", async () => {
		const s = spy();
		const seen: Array<Record<string, unknown>> = [];
		const intercept: TurnInterceptor = async ({ hostData }) => {
			seen.push(hostData);
			return undefined;
		};
		const d = deps({ constructAgent: s.constructAgent, intercept });
		await runTurn(d, { message: "a", hostData: { autoApprove: true, n: 2 } }, () => undefined);
		await runTurn(d, { message: "b" }, () => undefined);
		expect(seen).toEqual([{ autoApprove: true, n: 2 }, {}]);
	});

	test("flows from createHarness turn options", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "host-data-"));
		try {
			let seen: Record<string, unknown> = {};
			const harness = await createHarness({
				cwd,
				config: DEFAULT_CONFIG,
				provider,
				constructAgent: spy().constructAgent,
				observability: noopObservability,
				intercept: async ({ hostData }) => {
					seen = hostData;
					return undefined;
				},
			});
			await harness.runTurn("hi", () => undefined, { hostData: { mode: "voice" } });
			expect(seen).toEqual({ mode: "voice" });
			harness.close();
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});

describe("provider factory for hosts", () => {
	test("the interceptor receives the user's words and a provider factory", async () => {
		const s = spy();
		let seenMessage = "";
		let hasProvider = false;
		const calls: Array<[string, string | undefined]> = [];
		await runTurn(
			deps({
				constructAgent: s.constructAgent,
				resolveProvider: (id, title) => {
					calls.push([id, title]);
					return provider;
				},
				intercept: async (ctx) => {
					seenMessage = ctx.message;
					hasProvider = typeof ctx.provider === "function";
					ctx.provider?.("acme/model", "agent:writer");
					return { reply: "done" };
				},
			}),
			{ message: "[banner]\n\nopen notes", displayMessage: "open notes" },
			() => undefined,
		);
		expect(seenMessage).toBe("open notes");
		expect(hasProvider).toBe(true);
		expect(calls).toEqual([["acme/model", "agent:writer"]]);
	});

	test("with a fixed provider the factory returns it for every model", async () => {
		const s = spy();
		let got: MainModelProvider | undefined;
		await runTurn(
			deps({
				constructAgent: s.constructAgent,
				intercept: async (ctx) => {
					got = ctx.provider("any/model", "agent:writer");
					return { reply: "done" };
				},
			}),
			{ message: "hi" },
			() => undefined,
		);
		expect(got).toBe(provider);
	});

	test("the title becomes the X-Title header on real OpenRouter calls", async () => {
		const { constructOpenRouterProvider } = await import("./strands.ts");
		const seenTitles: string[] = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			seenTitles.push(headers.get("x-title") ?? "");
			return new Response(JSON.stringify({ error: { message: "stop" } }), { status: 400 });
		}) as unknown as typeof fetch;
		try {
			for (const title of ["agent:writer", undefined]) {
				const p = constructOpenRouterProvider({
					apiKey: "sk-test",
					model: "acme/model",
					baseUrl: "https://openrouter.ai/api/v1",
					...(title ? { title } : {}),
				});
				for await (const _event of p.stream({ messages: [{ role: "user", content: "hi" }] })) {
					// drain
				}
			}
		} finally {
			globalThis.fetch = realFetch;
		}
		expect(seenTitles[0]).toBe("agent:writer");
		expect(seenTitles[1]).toBe("Caelence agent");
	});
});

describe("browser turn option", () => {
	async function setup(config: Partial<typeof DEFAULT_CONFIG> = {}) {
		const cwd = await mkdtemp(join(tmpdir(), "host-browser-"));
		const counter = { starts: 0 };
		const seen = { tools: [] as string[] };
		const harness = await createHarness({
			cwd,
			config: { ...DEFAULT_CONFIG, ...config },
			provider,
			observability: noopObservability,
			constructAgent: (input) => {
				seen.tools = input.tools.map((t) => t.name);
				return { async run() {} };
			},
			browserLoader: async () => {
				counter.starts += 1;
				return {
					tools: [
						{
							name: "browser__browser_navigate",
							description: "navigate",
							inputSchema: { type: "object", properties: {} },
							annotations: UNKNOWN_TOOL_ANNOTATIONS,
							async handler() {
								return textResult("ok");
							},
						},
					],
					close: () => undefined,
				};
			},
		});
		return { cwd, harness, counter, seen };
	}

	test("turns the browser on for the turn and the rest of the chat, without @browser", async () => {
		const { cwd, harness, counter, seen } = await setup();
		try {
			expect(harness.browserActive).toBe(false);
			await harness.runTurn("write an article on medium", () => undefined, { browser: true });
			expect(seen.tools).toContain("browser__browser_navigate");
			expect(harness.browserActive).toBe(true);
			await harness.runTurn("now publish it", () => undefined);
			expect(seen.tools).toContain("browser__browser_navigate");
			expect(counter.starts).toBe(1);
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("does not start the server on turns that do not ask for it", async () => {
		const { cwd, harness, counter, seen } = await setup();
		try {
			await harness.runTurn("hello", () => undefined, { browser: false });
			await harness.runTurn("hello again", () => undefined);
			expect(counter.starts).toBe(0);
			expect(seen.tools).not.toContain("browser__browser_navigate");
			expect(harness.browserActive).toBe(false);
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("a new chat turns it off again", async () => {
		const { cwd, harness } = await setup();
		try {
			await harness.runTurn("go", () => undefined, { browser: true });
			expect(harness.browserActive).toBe(true);
			harness.setSession(undefined);
			expect(harness.browserActive).toBe(false);
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("config enabled:false wins over the turn option", async () => {
		const { cwd, harness, counter } = await setup({ browser: { enabled: false } });
		try {
			await harness.runTurn("go", () => undefined, { browser: true });
			expect(counter.starts).toBe(0);
			expect(harness.browserActive).toBe(false);
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("is ignored outside agent mode", async () => {
		const { cwd, harness, counter } = await setup({ mode: "ask" });
		try {
			await harness.runTurn("go", () => undefined, { browser: true });
			expect(counter.starts).toBe(0);
			expect(harness.browserActive).toBe(false);
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
