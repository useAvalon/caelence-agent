import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./config.ts";
import type { AgentEvent, MainModelProvider } from "./core/events.ts";
import { textResult, UNKNOWN_TOOL_ANNOTATIONS } from "./core/mcp.ts";
import type { loadStdioMcpTools } from "./core/stdio-mcp.ts";
import type { ConstructAgent } from "./core/strands.ts";
import { noopObservability } from "./observability/noop.ts";
import { createHarness } from "./runtime.ts";

const fakeProvider: MainModelProvider = {
	kind: "fake",
	modelId: "fake",
	async *stream() {
		yield { type: "done" };
	},
};

describe("createHarness modes", () => {
	test("ask mode does not expose write_file or exec", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-runtime-"));
		try {
			let names: string[] = [];
			const constructAgent: ConstructAgent = (input) => {
				names = input.tools.map((tool) => tool.name);
				return {
					async run(_message, emit) {
						emit({ kind: "text_delta", text: "ok" });
					},
				};
			};
			const harness = await createHarness({
				cwd,
				config: { ...DEFAULT_CONFIG, mode: "ask" },
				provider: fakeProvider,
				constructAgent,
				observability: noopObservability,
			});
			expect(harness.mode).toBe("ask");
			await harness.runTurn("inspect", () => undefined);
			expect(names).toContain("read_file");
			expect(names).toContain("git_status");
			expect(names).not.toContain("write_file");
			expect(names).not.toContain("exec");
			expect(names).not.toContain("git_commit");
			expect(names).not.toContain("todo_write");
			expect(names).not.toContain("task");

			harness.setMode("plan");
			await harness.runTurn("plan it", () => undefined);
			expect(names).toContain("todo_write");
			expect(names).not.toContain("write_file");

			harness.setMode("agent");
			await harness.runTurn("implement", () => undefined);
			expect(names).toContain("write_file");
			expect(names).toContain("git_commit");
			expect(names).toContain("task");
			harness.close();
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("starts without an OpenRouter key", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-nokey-"));
		const previous = process.env.OPENROUTER_API_KEY;
		delete process.env.OPENROUTER_API_KEY;
		try {
			const harness = await createHarness({
				cwd,
				config: DEFAULT_CONFIG,
				constructAgent: () => ({
					async run() {
						throw new Error("should not run");
					},
				}),
				observability: noopObservability,
			});
			expect(harness.hasApiKey).toBe(false);
			harness.close();
		} finally {
			if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
			else process.env.OPENROUTER_API_KEY = previous;
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("injects retrieved memory when the user has enabled it", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-mem-rt-"));
		const home = await mkdtemp(join(tmpdir(), "harness-mem-rt-home-"));
		const prevHome = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		try {
			const { writeMemoryPrefs } = await import("./memory/prefs.ts");
			const { addFacts } = await import("./memory/store.ts");
			writeMemoryPrefs({ enabled: true });
			addFacts(cwd, [{ text: "Prefer bun over npm for installs", scope: "user" }]);
			let prompt = "";
			const harness = await createHarness({
				cwd,
				config: DEFAULT_CONFIG,
				provider: fakeProvider,
				constructAgent: (input) => {
					prompt = input.systemPrompt;
					return {
						async run(_message, emit) {
							emit({ kind: "text_delta", text: "ok" });
						},
					};
				},
				observability: noopObservability,
			});
			await harness.runTurn("which package manager for installs", () => undefined);
			expect(prompt).toContain("## Memory");
			expect(prompt).toContain("Prefer bun over npm for installs");
			harness.close();
		} finally {
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			await rm(cwd, { recursive: true, force: true });
			await rm(home, { recursive: true, force: true });
		}
	});

	test("accumulates usage on the runtime", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-spend-"));
		try {
			const provider: MainModelProvider = {
				kind: "fake",
				modelId: "fake",
				async *stream() {
					yield { type: "done" };
				},
				takeUsage() {
					return { promptTokens: 3, completionTokens: 1, totalTokens: 4 };
				},
			};
			const harness = await createHarness({
				cwd,
				config: DEFAULT_CONFIG,
				provider,
				constructAgent: () => ({
					async run(_message, emit) {
						emit({ kind: "text_delta", text: "ok" });
					},
				}),
				observability: noopObservability,
			});
			const events: AgentEvent["kind"][] = [];
			await harness.runTurn("hi", (event) => events.push(event.kind));
			expect(events).toContain("usage");
			expect(harness.spend).toEqual({ promptTokens: 3, completionTokens: 1, totalTokens: 4 });
			harness.close();
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});

describe("createHarness browser", () => {
	function browserLoader(counter: { starts: number; closes: number }): typeof loadStdioMcpTools {
		return async () => {
			counter.starts += 1;
			return {
				tools: ["browser__browser_navigate", "browser__browser_extract_content"].map((name) => ({
					name,
					description: name,
					inputSchema: { type: "object", properties: {} },
					annotations: UNKNOWN_TOOL_ANNOTATIONS,
					async handler() {
						return textResult("ok");
					},
				})),
				close: () => {
					counter.closes += 1;
				},
			};
		};
	}

	async function setup(
		overrides: Partial<typeof DEFAULT_CONFIG>,
		loader: typeof loadStdioMcpTools,
	) {
		const cwd = await mkdtemp(join(tmpdir(), "harness-browser-"));
		const seen: { names: string[]; prompt: string } = { names: [], prompt: "" };
		const harness = await createHarness({
			cwd,
			config: { ...DEFAULT_CONFIG, ...overrides },
			provider: fakeProvider,
			browserLoader: loader,
			constructAgent: (input) => {
				seen.names = input.tools.map((tool) => tool.name);
				seen.prompt = input.systemPrompt;
				return {
					async run(_message, emit) {
						emit({ kind: "text_delta", text: "ok" });
					},
				};
			},
			observability: noopObservability,
		});
		return { cwd, harness, seen };
	}

	test("is off by default and does not start the server", async () => {
		const counter = { starts: 0, closes: 0 };
		const { cwd, harness, seen } = await setup({}, browserLoader(counter));
		try {
			await harness.runTurn("open example.com in the browser", () => undefined);
			expect(seen.names.some((n) => n.startsWith("browser_"))).toBe(false);
			expect(seen.names.some((n) => n.startsWith("browser__"))).toBe(false);
			expect(seen.prompt).not.toContain("## Browser");
			expect(counter.starts).toBe(0);
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("@browser turns it on, stays on for the chat, and starts once", async () => {
		const counter = { starts: 0, closes: 0 };
		const { cwd, harness, seen } = await setup({}, browserLoader(counter));
		try {
			await harness.runTurn("@browser open example.com", () => undefined);
			expect(seen.names).toContain("browser__browser_navigate");
			expect(seen.names).not.toContain("browser__browser_extract_content");
			expect(seen.prompt).toContain("## Browser");

			await harness.runTurn("now click the first link", () => undefined);
			expect(seen.names).toContain("browser__browser_navigate");
			expect(counter.starts).toBe(1);
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
		await Bun.sleep(10);
		expect(counter.closes).toBe(1);
	});

	test("a new chat drops the browser until @browser is used again", async () => {
		const counter = { starts: 0, closes: 0 };
		const { cwd, harness, seen } = await setup({}, browserLoader(counter));
		try {
			await harness.runTurn("@browser open example.com", () => undefined);
			harness.setSession(undefined);
			await harness.runTurn("what is 2+2", () => undefined);
			expect(seen.names).not.toContain("browser__browser_navigate");
			await harness.runTurn("@browser again", () => undefined);
			expect(seen.names).toContain("browser__browser_navigate");
			expect(counter.starts).toBe(1);
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("enabled: true exposes it without a mention", async () => {
		const counter = { starts: 0, closes: 0 };
		const { cwd, harness, seen } = await setup(
			{ browser: { enabled: true } },
			browserLoader(counter),
		);
		try {
			await harness.runTurn("hello", () => undefined);
			expect(seen.names).toContain("browser__browser_navigate");
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("enabled: false ignores @browser", async () => {
		const counter = { starts: 0, closes: 0 };
		const { cwd, harness, seen } = await setup(
			{ browser: { enabled: false } },
			browserLoader(counter),
		);
		try {
			await harness.runTurn("@browser open example.com", () => undefined);
			expect(seen.names).not.toContain("browser__browser_navigate");
			expect(counter.starts).toBe(0);
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("ask and plan modes never start it", async () => {
		const counter = { starts: 0, closes: 0 };
		const { cwd, harness, seen } = await setup({ mode: "ask" }, browserLoader(counter));
		try {
			await harness.runTurn("@browser open example.com", () => undefined);
			expect(seen.names).not.toContain("browser__browser_navigate");
			expect(counter.starts).toBe(0);
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("a failed start tells the model, and the next turn retries", async () => {
		let calls = 0;
		const loader: typeof loadStdioMcpTools = async () => {
			calls += 1;
			if (calls === 1) throw new Error('Executable not found in $PATH: "uvx"');
			return { tools: [], close: () => undefined };
		};
		const { cwd, harness, seen } = await setup({}, loader);
		try {
			await harness.runTurn("@browser open example.com", () => undefined);
			expect(seen.prompt).toContain("could not start");
			expect(seen.prompt).toContain("docs.astral.sh/uv");
			await harness.runTurn("try again", () => undefined);
			expect(seen.prompt).toContain("## Browser");
			expect(seen.prompt).not.toContain("could not start");
			expect(calls).toBe(2);
		} finally {
			harness.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
