import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config.ts";
import type { AgentEvent, AgentEventEmitter, MainModelProvider } from "../core/events.ts";
import { jsonResult, type McpToolDefinition, READ_ONLY_ANNOTATIONS } from "../core/mcp.ts";
import type { ConstructAgent } from "../core/strands.ts";
import { createHarness } from "../runtime.ts";
import {
	type BackgroundAgentRunInput,
	type BackgroundAgentSnapshot,
	createBackgroundAgents,
	readOnlyTools,
} from "./background.ts";

const fakeProvider: MainModelProvider = {
	kind: "fake",
	modelId: "fake",
	async *stream() {
		yield { type: "done" };
	},
};

/** A run function the test finishes by hand, one agent at a time. */
function manualRuns() {
	const started: Array<BackgroundAgentRunInput & { finish(text?: string): void }> = [];
	const run = (input: BackgroundAgentRunInput): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			started.push({
				...input,
				finish(text = "report") {
					input.emit({ kind: "text_delta", text });
					resolve();
				},
			});
		});
	return { started, run };
}

function toolNamed(tools: McpToolDefinition[], name: string): McpToolDefinition {
	const tool = tools.find((item) => item.name === name);
	if (!tool) throw new Error(`${name} missing`);
	return tool;
}

function agentsOf(result: { structuredContent?: Record<string, unknown> }) {
	return (result.structuredContent?.agents ?? []) as BackgroundAgentSnapshot[];
}

const noEmit: AgentEventEmitter = () => undefined;

describe("background agents", () => {
	test("spawn returns at once and await returns the report", async () => {
		const runs = manualRuns();
		const bg = createBackgroundAgents({ run: runs.run, parentEmit: () => noEmit });
		const spawned = await toolNamed(bg.tools, "spawn_agent").handler({
			prompt: "find the router",
			label: "router",
		});
		expect(spawned.isError).toBeFalsy();
		expect(spawned.structuredContent).toMatchObject({ id: "bg_1", kind: "explore" });
		expect(bg.pending()).toBe(1);
		expect(runs.started[0]?.kind).toBe("explore");

		const waiting = toolNamed(bg.tools, "await_agents").handler({});
		runs.started[0]?.finish("router is in src/router.ts:12");
		const [agent] = agentsOf(await waiting);
		expect(agent).toMatchObject({
			id: "bg_1",
			status: "done",
			result: "router is in src/router.ts:12",
		});
		expect(bg.pending()).toBe(0);
	});

	test("runs at most maxConcurrent at once and queues the rest", async () => {
		const runs = manualRuns();
		const bg = createBackgroundAgents({
			run: runs.run,
			parentEmit: () => noEmit,
			maxConcurrent: 2,
		});
		const spawn = toolNamed(bg.tools, "spawn_agent");
		await Promise.all(["a", "b", "c"].map((label) => spawn.handler({ prompt: label, label })));
		expect(runs.started).toHaveLength(2);
		expect(bg.snapshot().map((agent) => agent.status)).toEqual(["running", "running", "queued"]);
		runs.started[0]?.finish();
		await Bun.sleep(0);
		expect(runs.started).toHaveLength(3);
	});

	test("refuses more agents than the per-turn cap", async () => {
		const runs = manualRuns();
		const bg = createBackgroundAgents({ run: runs.run, parentEmit: () => noEmit, maxAgents: 1 });
		const spawn = toolNamed(bg.tools, "spawn_agent");
		expect((await spawn.handler({ prompt: "one" })).isError).toBeFalsy();
		expect((await spawn.handler({ prompt: "two" })).isError).toBe(true);
	});

	test("refuses a kind the host did not offer", async () => {
		const runs = manualRuns();
		const bg = createBackgroundAgents({
			run: runs.run,
			parentEmit: () => noEmit,
			kinds: ["explore"],
		});
		const result = await toolNamed(bg.tools, "spawn_agent").handler({
			prompt: "edit it",
			kind: "general",
		});
		expect(result.isError).toBe(true);
		expect(runs.started).toHaveLength(0);
	});

	test("await with a timeout reports an agent that is still running", async () => {
		const runs = manualRuns();
		const bg = createBackgroundAgents({ run: runs.run, parentEmit: () => noEmit });
		await toolNamed(bg.tools, "spawn_agent").handler({ prompt: "slow" });
		const result = await toolNamed(bg.tools, "await_agents").handler({ timeout_seconds: 0.01 });
		expect(agentsOf(result)[0]?.status).toBe("running");
		expect(agentsOf(result)[0]?.result).toBeUndefined();
	});

	test("a failed run is reported as failed, with the error", async () => {
		const bg = createBackgroundAgents({
			run: async () => {
				throw new Error("model unavailable");
			},
			parentEmit: () => noEmit,
		});
		await toolNamed(bg.tools, "spawn_agent").handler({ prompt: "x" });
		const [agent] = agentsOf(await toolNamed(bg.tools, "await_agents").handler({}));
		expect(agent).toMatchObject({ status: "failed", error: "model unavailable" });
	});

	test("another tool's result announces a finished agent once", async () => {
		const runs = manualRuns();
		const bg = createBackgroundAgents({ run: runs.run, parentEmit: () => noEmit });
		const grep = bg.withNotices({
			name: "grep",
			description: "search",
			annotations: READ_ONLY_ANNOTATIONS,
			inputSchema: { type: "object", properties: {} },
			handler: async () => jsonResult({ hits: [] }),
		});
		await toolNamed(bg.tools, "spawn_agent").handler({ prompt: "x", label: "auth" });
		expect((await grep.handler({})).content).toHaveLength(1);

		runs.started[0]?.finish();
		await Bun.sleep(0);
		const noticed = await grep.handler({});
		expect(noticed.content[1]?.text).toContain("bg_1 (auth, done)");
		expect(noticed.structuredContent).toMatchObject({
			hits: [],
			background_agents_finished: ["bg_1"],
		});
		expect((await grep.handler({})).content).toHaveLength(1);
	});

	test("close cancels what is running and stops forwarding its events", async () => {
		const runs = manualRuns();
		const seen: AgentEvent[] = [];
		const bg = createBackgroundAgents({
			run: runs.run,
			parentEmit: () => (event) => {
				seen.push(event);
			},
		});
		await toolNamed(bg.tools, "spawn_agent").handler({ prompt: "x" });
		const agent = runs.started[0];
		agent?.emit({ kind: "tool_call_start", toolName: "grep", callId: "c1", input: {} });
		expect(seen).toHaveLength(1);
		bg.close();
		expect(agent?.signal.aborted).toBe(true);
		agent?.emit({ kind: "tool_call_start", toolName: "grep", callId: "c2", input: {} });
		expect(seen).toHaveLength(1);
		expect(bg.snapshot()[0]?.status).toBe("cancelled");
		expect((await toolNamed(bg.tools, "spawn_agent").handler({ prompt: "late" })).isError).toBe(
			true,
		);
	});

	test("the parent signal cancels every agent", async () => {
		const runs = manualRuns();
		const controller = new AbortController();
		const bg = createBackgroundAgents({
			run: runs.run,
			parentEmit: () => noEmit,
			signal: controller.signal,
		});
		await toolNamed(bg.tools, "spawn_agent").handler({ prompt: "x" });
		controller.abort();
		expect(bg.snapshot()[0]?.status).toBe("cancelled");
	});

	test("nested errors and text never reach the parent stream", async () => {
		const seen: AgentEvent[] = [];
		const bg = createBackgroundAgents({
			run: async ({ emit }) => {
				emit({ kind: "text_delta", text: "partial" });
				emit({ kind: "error", message: "boom" });
				emit({ kind: "completion" });
			},
			parentEmit: () => (event) => {
				seen.push(event);
			},
		});
		await toolNamed(bg.tools, "spawn_agent").handler({ prompt: "x" });
		const [agent] = agentsOf(await toolNamed(bg.tools, "await_agents").handler({}));
		expect(agent).toMatchObject({ status: "failed", error: "boom", result: "partial" });
		expect(seen).toHaveLength(0);
	});

	test("readOnlyTools keeps only tools that declare themselves read-only", () => {
		const make = (name: string, readOnlyHint: boolean): McpToolDefinition => ({
			name,
			description: name,
			annotations: { ...READ_ONLY_ANNOTATIONS, readOnlyHint },
			inputSchema: { type: "object", properties: {} },
			handler: async () => jsonResult({}),
		});
		expect(
			readOnlyTools([make("grep", true), make("write_file", false)]).map((t) => t.name),
		).toEqual(["grep"]);
	});
});

describe("background agents in the harness", () => {
	test("an explore agent runs in the background with read-only tools", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-bg-"));
		try {
			await writeFile(join(cwd, "notes.txt"), "the answer is 42");
			let exploreTools: string[] = [];
			let exploreSystem = "";
			let report = "";
			const constructAgent: ConstructAgent = (input) => ({
				async run(_message, emit) {
					const spawn = input.tools.find((t) => t.name === "spawn_agent");
					if (spawn) {
						await spawn.invoke({ prompt: "read notes.txt", label: "notes" });
						const waited = await input.tools
							.find((t) => t.name === "await_agents")
							?.invoke({ timeout_seconds: 5 });
						report = JSON.stringify(waited?.structuredContent ?? {});
						emit({ kind: "text_delta", text: "parent" });
						return;
					}
					exploreTools = input.tools.map((t) => t.name);
					exploreSystem = input.systemPrompt;
					const read = input.tools.find((t) => t.name === "read_file");
					const result = await read?.invoke({ path: "notes.txt" });
					emit({ kind: "text_delta", text: JSON.stringify(result ?? {}) });
				},
			});
			const harness = await createHarness({
				cwd,
				config: { ...DEFAULT_CONFIG, tools: { exec: { approval: "deny" } } },
				provider: fakeProvider,
				constructAgent,
				approvalPolicy: "deny",
			});
			await harness.runTurn("where is the answer", () => undefined);
			expect(exploreTools).toContain("read_file");
			expect(exploreTools).toContain("grep");
			expect(exploreTools).not.toContain("write_file");
			expect(exploreTools).not.toContain("exec");
			expect(exploreTools).not.toContain("spawn_agent");
			expect(exploreTools).not.toContain("task");
			expect(exploreSystem).toContain("read-only explorer");
			expect(report).toContain("the answer is 42");
			expect(report).toContain('"status":"done"');
			harness.close();
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("background agents can be turned off", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-bg-off-"));
		try {
			let names: string[] = [];
			const constructAgent: ConstructAgent = (input) => ({
				async run(_message, emit) {
					names = input.tools.map((t) => t.name);
					emit({ kind: "text_delta", text: "ok" });
				},
			});
			const harness = await createHarness({
				cwd,
				config: { ...DEFAULT_CONFIG, subagents: { background: false } },
				provider: fakeProvider,
				constructAgent,
			});
			await harness.runTurn("hi", () => undefined);
			expect(names).toContain("task");
			expect(names).not.toContain("spawn_agent");
			harness.close();
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
