import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./config.ts";
import type { AgentEvent, MainModelProvider } from "./core/events.ts";
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
