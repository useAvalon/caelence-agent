import { describe, expect, test } from "bun:test";
import { categorizeFailure } from "./categories.ts";
import { runLocalExperiment } from "./experiments.ts";
import { createRecordingObservability } from "./fake.ts";
import { parseQualityScores, qualityEvalEnabled, scoreQualityDimensions } from "./judges.ts";
import { harnessPromptRecords, promptVersionHash } from "./prompts.ts";
import { WEBSITE_GENERATION_REGRESSION } from "./regression-items.ts";

describe("categorizeFailure", () => {
	test("maps gates and error types", () => {
		expect(categorizeFailure({ typecheckPass: false })).toBe("BUILD_ERROR");
		expect(categorizeFailure({ uiPass: false })).toBe("RUNTIME_ERROR");
		expect(categorizeFailure({ errorType: "tdd_failed" })).toBe("CODE_GENERATION_ERROR");
		expect(categorizeFailure({ timedOut: true })).toBe("TIMEOUT");
		expect(categorizeFailure({ phase: "mcp" })).toBe("TOOL_ERROR");
	});
});

describe("parseQualityScores", () => {
	test("extracts 0-1 dimensions from JSON", () => {
		const scores = parseQualityScores(
			'noise {"instruction_following": 0.9, "visual_quality": 1.4, "nope": 3} trailing',
		);
		expect(scores?.instruction_following).toBe(0.9);
		expect(scores?.visual_quality).toBe(1);
		expect(scores?.nope).toBeUndefined();
	});
});

describe("scoreQualityDimensions", () => {
	test("posts parsed dimensions onto the observer", async () => {
		const obs = createRecordingObservability();
		const scores = await scoreQualityDimensions({
			obs,
			model: "fake",
			userRequest: "A bakery site",
			artifact: "<html></html>",
			chat: async () =>
				JSON.stringify({
					instruction_following: 0.8,
					visual_quality: 0.5,
					content_quality: 0.7,
					design_consistency: 0.6,
					ux_quality: 0.4,
					code_quality: 0.9,
				}),
		});
		expect(scores?.instruction_following).toBe(0.8);
		expect(obs.scores).toHaveLength(6);
	});
});

describe("qualityEvalEnabled", () => {
	test("is off unless explicitly opted in", () => {
		expect(qualityEvalEnabled({})).toBe(false);
		expect(qualityEvalEnabled({ LANGFUSE_QUALITY_EVAL: "1" })).toBe(true);
		expect(qualityEvalEnabled({ LANGFUSE_QUALITY_EVAL: "true" })).toBe(true);
		expect(qualityEvalEnabled({ LANGFUSE_QUALITY_EVAL: "no" })).toBe(false);
	});
});

describe("promptVersionHash", () => {
	test("is stable for the same body", () => {
		expect(promptVersionHash("hello")).toBe(promptVersionHash("hello"));
		expect(promptVersionHash("hello")).not.toBe(promptVersionHash("hello "));
	});
});

describe("harnessPromptRecords", () => {
	test("loads bundled copywriting and impeccable skills", () => {
		const names = harnessPromptRecords().map((p) => p.name);
		expect(names).toContain("copywriting");
		expect(names).toContain("impeccable");
	});
});

describe("regression seed", () => {
	test("has twenty briefs with no invented metrics", () => {
		expect(WEBSITE_GENERATION_REGRESSION).toHaveLength(20);
		for (const item of WEBSITE_GENERATION_REGRESSION) {
			const brief =
				item.input && typeof item.input === "object" && "brief" in item.input
					? String((item.input as { brief?: unknown }).brief ?? "")
					: "";
			expect(brief.length).toBeGreaterThan(10);
		}
	});
});

describe("runLocalExperiment", () => {
	test("aggregates evaluator scores and honors a gate", async () => {
		const obs = createRecordingObservability();
		const result = await runLocalExperiment({
			name: "website-generation-regression",
			observability: obs,
			items: [
				{ id: "a", input: "one" },
				{ id: "b", input: "two" },
			],
			task: async (item) => String(item.input),
			evaluators: [
				{
					name: "build_success",
					run: ({ output }) => ({ value: output === "one" ? 1 : 0 }),
				},
			],
			gate: { score: "build_success", min: 0.9 },
		});
		expect(result.aggregates.build_success).toBe(0.5);
		expect(result.ok).toBe(false);
		expect(obs.turns[0]?.name).toBe("website-generation-regression");
	});
});
