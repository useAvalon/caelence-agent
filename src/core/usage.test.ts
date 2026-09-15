import { describe, expect, test } from "bun:test";
import { addUsage, formatUsage, parseTokenUsage, reasoningTextFromChunk } from "./usage.ts";

describe("token usage", () => {
	test("parses OpenAI and OpenRouter shapes", () => {
		expect(
			parseTokenUsage({
				usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.002 },
			}),
		).toEqual({
			promptTokens: 10,
			completionTokens: 4,
			totalTokens: 14,
			costUsd: 0.002,
		});
		expect(parseTokenUsage({ promptTokens: 2, completionTokens: 3 })).toEqual({
			promptTokens: 2,
			completionTokens: 3,
			totalTokens: 5,
		});
		expect(parseTokenUsage({ hello: 1 })).toBeUndefined();
	});

	test("adds usage and only keeps cost when a side reported it", () => {
		expect(addUsage({ promptTokens: 1, completionTokens: 2, totalTokens: 3 }, undefined)).toEqual({
			promptTokens: 1,
			completionTokens: 2,
			totalTokens: 3,
		});
		expect(
			addUsage(
				{ promptTokens: 1, completionTokens: 1, totalTokens: 2 },
				{ promptTokens: 4, completionTokens: 5, totalTokens: 9, costUsd: 0.1 },
			),
		).toEqual({
			promptTokens: 5,
			completionTokens: 6,
			totalTokens: 11,
			costUsd: 0.1,
		});
	});

	test("formatUsage does not invent a dollar amount", () => {
		expect(formatUsage({ promptTokens: 12, completionTokens: 3, totalTokens: 15 })).toBe(
			"12 in · 3 out",
		);
		expect(
			formatUsage({ promptTokens: 12, completionTokens: 3, totalTokens: 15, costUsd: 0.2 }),
		).toBe("12 in · 3 out · $0.20");
	});

	test("reads OpenRouter reasoning deltas from chat chunks", () => {
		expect(
			reasoningTextFromChunk({
				choices: [{ delta: { reasoning: "look at the page" } }],
			}),
		).toBe("look at the page");
		expect(
			reasoningTextFromChunk({
				choices: [{ delta: { reasoning_content: "step" } }],
			}),
		).toBe("step");
		expect(
			reasoningTextFromChunk({
				choices: [{ delta: { content: "hello" } }],
			}),
		).toBeUndefined();
	});
});
