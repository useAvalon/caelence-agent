import { describe, expect, test } from "bun:test";
import {
	DEFAULT_REASONING_EFFORT,
	parseReasoningEffort,
	REASONING_EFFORTS,
	resolveReasoningEffort,
	tryParseReasoningEffort,
} from "./reasoning.ts";

describe("reasoning effort", () => {
	test("accepts OpenRouter effort values", () => {
		expect(REASONING_EFFORTS).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
		expect(tryParseReasoningEffort("HIGH")).toBe("high");
		expect(tryParseReasoningEffort(" xhigh ")).toBe("xhigh");
		expect(tryParseReasoningEffort("max")).toBeUndefined();
		expect(parseReasoningEffort(undefined)).toBe(DEFAULT_REASONING_EFFORT);
		expect(parseReasoningEffort("nope")).toBe("low");
	});

	test("prefers option, then env, then config", () => {
		expect(
			resolveReasoningEffort({
				option: "medium",
				config: "high",
				env: { HARNESS_REASONING_EFFORT: "xhigh" },
			}),
		).toBe("medium");
		expect(
			resolveReasoningEffort({
				config: "high",
				env: { HARNESS_REASONING_EFFORT: "xhigh" },
			}),
		).toBe("xhigh");
		expect(resolveReasoningEffort({ config: "minimal", env: {} })).toBe("minimal");
		expect(resolveReasoningEffort({ env: { HARNESS_REASONING_EFFORT: "nope" } })).toBe("low");
	});
});
