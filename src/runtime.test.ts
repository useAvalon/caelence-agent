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
