import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecordingObservability } from "../observability/fake.ts";
import { createLocalTools } from "../tools/local.ts";
import { createMemoryTodoStore, createTodoTool } from "../tools/todo.ts";
import { createExecApprovalGate } from "./approval.ts";
import type { AgentEvent, MainModelProvider } from "./events.ts";
import type { HookRunner } from "./hooks.ts";
import { buildSystemPrompt, type RunTurnDeps, runTurn } from "./run-turn.ts";
import { createFileSessionStore, sessionToProviderMessages } from "./session.ts";
import type { ConstructAgent } from "./strands.ts";

const fakeProvider: MainModelProvider = {
	kind: "fake",
	modelId: "fake",
	async *stream() {
		yield { type: "done" };
	},
};

describe("runTurn", () => {
	test("fake agent writes a file and emits agent events", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-turn-"));
		try {
			const constructAgent: ConstructAgent = (input) => ({
				async run(_message, emit) {
					emit({ kind: "text_delta", text: "editing…" });
					const write = input.tools.find((t) => t.name === "write_file");
					if (!write) throw new Error("write_file missing");
					await write.invoke({ path: "hello.txt", content: "hi" });
					emit({ kind: "text_delta", text: " done" });
				},
			});
			const events: AgentEvent["kind"][] = [];
			const deps: RunTurnDeps = {
				cwd,
				name: "test",
				systemPrompt: "test",
				tools: createLocalTools({ cwd }).listTools(),
				approval: createExecApprovalGate({ policy: "deny" }),
				store: createFileSessionStore(cwd),
				provider: fakeProvider,
				constructAgent,
			};
			const session = await runTurn(deps, { message: "write hello" }, (event) => {
				events.push(event.kind);
			});
			expect(events[0]).toBe("session_meta");
			expect(events).toContain("text_delta");
			expect(events).toContain("tool_call_start");
			expect(events).toContain("tool_call_end");
			expect(events[events.length - 1]).toBe("completion");
			expect(await readFile(join(cwd, "hello.txt"), "utf8")).toBe("hi");
			const stored = session ? await deps.store.get(session.id) : undefined;
			expect(
				stored?.messages.some(
					(message) => message.kind === "tool" && message.name === "write_file",
				),
			).toBe(true);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("records nested tool spans on the observer", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-obs-"));
		try {
			const obs = createRecordingObservability();
			const constructAgent: ConstructAgent = (input) => ({
				async run(_message, emit) {
					const write = input.tools.find((t) => t.name === "write_file");
					if (!write) throw new Error("write_file missing");
					await write.invoke({ path: "a.txt", content: "x" });
					emit({ kind: "text_delta", text: "ok" });
				},
			});
			await runTurn(
				{
					cwd,
					name: "test",
					systemPrompt: "test",
					tools: createLocalTools({ cwd }).listTools(),
					approval: createExecApprovalGate({ policy: "deny" }),
					store: createFileSessionStore(cwd),
					provider: fakeProvider,
					constructAgent,
					observability: obs,
				},
				{ message: "write" },
				() => undefined,
			);
			expect(obs.turns[0]?.name).toBe("agent_turn");
			expect(obs.turns[0]?.children.some((c) => c.kind === "tool" && c.name === "write_file")).toBe(
				true,
			);
			expect(obs.turns[0]?.children.some((c) => c.kind === "generation")).toBe(true);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("emits usage when the provider reports it", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-usage-"));
		try {
			let taken = false;
			const provider: MainModelProvider = {
				kind: "fake",
				modelId: "fake",
				async *stream() {
					yield { type: "done" };
				},
				takeUsage() {
					if (taken) return undefined;
					taken = true;
					return { promptTokens: 8, completionTokens: 2, totalTokens: 10 };
				},
			};
			const events: AgentEvent[] = [];
			await runTurn(
				{
					cwd,
					name: "test",
					systemPrompt: "test",
					tools: [],
					approval: createExecApprovalGate({ policy: "deny" }),
					store: createFileSessionStore(cwd),
					provider,
					constructAgent: () => ({
						async run(_message, emit) {
							emit({ kind: "text_delta", text: "ok" });
						},
					}),
				},
				{ message: "hi" },
				(event) => events.push(event),
			);
			expect(events.some((event) => event.kind === "usage" && event.promptTokens === 8)).toBe(true);
			expect(events.some((event) => event.kind === "usage" && "costUsd" in event)).toBe(false);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("emits todos after todo_write and honors a denying pre_tool hook", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-todos-"));
		try {
			const hooks: HookRunner = {
				sessionStart: async () => undefined,
				preTool: async (name) =>
					name === "write_file" ? { allow: false, reason: "blocked" } : { allow: true },
				postTool: async () => undefined,
			};
			const events: AgentEvent[] = [];
			const constructAgent: ConstructAgent = (input) => ({
				async run() {
					const todo = input.tools.find((t) => t.name === "todo_write");
					const write = input.tools.find((t) => t.name === "write_file");
					if (!todo || !write) throw new Error("tools missing");
					await todo.invoke({
						items: [{ id: "1", content: "inspect", status: "pending" }],
					});
					const denied = await write.invoke({ path: "nope.txt", content: "x" });
					expect(denied.isError).toBe(true);
				},
			});
			await runTurn(
				{
					cwd,
					name: "test",
					systemPrompt: "test",
					tools: [
						...createLocalTools({ cwd }).listTools(),
						createTodoTool(createMemoryTodoStore()),
					],
					approval: createExecApprovalGate({ policy: "deny" }),
					store: createFileSessionStore(cwd),
					provider: fakeProvider,
					constructAgent,
					hooks,
				},
				{ message: "plan" },
				(event) => events.push(event),
			);
			const todos = events.find((event) => event.kind === "todos");
			expect(todos?.kind === "todos" && todos.items[0]?.content).toBe("inspect");
			expect(
				events.some(
					(event) =>
						event.kind === "tool_call_end" && event.toolName === "write_file" && !event.success,
				),
			).toBe(true);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("buildSystemPrompt stacks layers and mode", () => {
		const prompt = buildSystemPrompt({
			name: "harness",
			cwd: "/tmp/proj",
			userInstructions: "prefer bun",
			projectInstructions: "no secrets",
			mode: "ask",
		});
		expect(prompt).toContain("## User instructions");
		expect(prompt).toContain("prefer bun");
		expect(prompt).toContain("## Project instructions");
		expect(prompt).toContain("no secrets");
		expect(prompt).toContain("## Mode: ask");
		expect(prompt).toContain("You are a coding agent in this project.");
		expect(prompt).not.toContain("You are harness, a coding agent working in /tmp/proj");
		expect(prompt).toContain("plain text");
	});

	test("abort keeps the partial assistant reply", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-abort-"));
		try {
			const controller = new AbortController();
			const store = createFileSessionStore(cwd);
			const pending = runTurn(
				{
					cwd,
					name: "test",
					systemPrompt: "test",
					tools: [],
					approval: createExecApprovalGate({ policy: "deny" }),
					store,
					provider: fakeProvider,
					constructAgent: () => ({
						async run(_message, emit, options) {
							emit({ kind: "text_delta", text: "partial" });
							await new Promise<void>((_, reject) => {
								const fail = (): void => {
									reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
								};
								if (options?.signal?.aborted) fail();
								else options?.signal?.addEventListener("abort", fail, { once: true });
							});
						},
					}),
				},
				{ message: "go" },
				() => undefined,
				{ signal: controller.signal },
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			controller.abort();
			const session = await pending;
			expect(
				session?.messages.some(
					(m) => m.kind === "turn" && m.role === "assistant" && m.content === "partial",
				),
			).toBe(true);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("editUserTurn replaces the user message instead of appending", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-edit-turn-"));
		try {
			const store = createFileSessionStore(cwd);
			let session = await store.create("system");
			session = await store.append(session, { kind: "turn", role: "user", content: "old" });
			session = await store.append(session, {
				kind: "turn",
				role: "assistant",
				content: "old reply",
			});
			await runTurn(
				{
					cwd,
					name: "test",
					systemPrompt: "test",
					tools: [],
					approval: createExecApprovalGate({ policy: "deny" }),
					store,
					provider: fakeProvider,
					constructAgent: () => ({
						async run(_message, emit) {
							emit({ kind: "text_delta", text: "new reply" });
						},
					}),
				},
				{ message: "edited", sessionId: session.id, editUserTurn: 0 },
				() => undefined,
			);
			const loaded = await store.get(session.id);
			expect(sessionToProviderMessages(loaded!)).toEqual([
				{ role: "user", content: "edited" },
				{ role: "assistant", content: "new reply" },
			]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("persists reasoning as a thought line before the assistant reply", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-thought-"));
		try {
			const store = createFileSessionStore(cwd);
			await runTurn(
				{
					cwd,
					name: "test",
					systemPrompt: "test",
					tools: [],
					approval: createExecApprovalGate({ policy: "deny" }),
					store,
					provider: fakeProvider,
					constructAgent: () => ({
						async run(_message, emit) {
							emit({ kind: "reasoning_delta", text: "I should answer directly." });
							emit({ kind: "text_delta", text: "ok" });
						},
					}),
				},
				{ message: "hi" },
				() => undefined,
			);
			const listed = await store.list();
			const session = listed[0];
			expect(session?.messages.map((message) => message.kind)).toEqual([
				"system",
				"turn",
				"thought",
				"turn",
			]);
			const thought = session?.messages.find((message) => message.kind === "thought");
			expect(thought && thought.kind === "thought" ? thought.text : "").toBe(
				"I should answer directly.",
			);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
