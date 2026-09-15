import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EvalSuite, runEvalSuite } from "./runner.ts";

describe("eval runner", () => {
	test("runs steps, writes artifacts, records scan failures", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-eval-"));
		try {
			const suite: EvalSuite = {
				name: "unit",
				steps: [
					{
						id: "echo",
						system: "be brief",
						user: "ping",
						artifact: "echo.txt",
						scan: (text) => ({ ok: text.includes("ok") }),
					},
					{
						id: "fail",
						user: "nope",
						scan: () => ({ ok: false, detail: "expected fail" }),
					},
				],
			};
			const result = await runEvalSuite({
				suite,
				cwd,
				model: "fake",
				chat: async ({ user }) => (user === "ping" ? "ok" : "no"),
			});
			expect(result.steps[0]?.ok).toBe(true);
			expect(result.steps[1]?.ok).toBe(false);
			expect(result.ok).toBe(false);
			const artifact = await readFile(join(cwd, ".harness", "evals", "unit", "echo.txt"), "utf8");
			expect(artifact).toBe("ok");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
