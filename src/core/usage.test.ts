import { describe, expect, test } from "bun:test";
import {
	addUsage,
	createUsageTrackingFetch,
	formatUsage,
	mergeRequestUsage,
	parseTokenUsage,
	reasoningTextFromChunk,
} from "./usage.ts";

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

	test("mergeRequestUsage keeps billed cost when a later chunk reports zeros", () => {
		expect(
			mergeRequestUsage(
				{ promptTokens: 80_000, completionTokens: 4_000, totalTokens: 84_000, costUsd: 5.4 },
				{ promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
			),
		).toEqual({
			promptTokens: 80_000,
			completionTokens: 4_000,
			totalTokens: 84_000,
			costUsd: 5.4,
		});
	});

	test("formatUsage does not invent a dollar amount", () => {
		expect(formatUsage({ promptTokens: 12, completionTokens: 3, totalTokens: 15 })).toBe(
			"12 in · 3 out",
		);
		expect(
			formatUsage({ promptTokens: 12, completionTokens: 3, totalTokens: 15, costUsd: 0.2 }),
		).toBe("12 in · 3 out · $0.20");
		expect(
			formatUsage({
				promptTokens: 80_000,
				completionTokens: 4_000,
				totalTokens: 84_000,
				costUsd: 5.4,
			}),
		).toBe("80000 in · 4000 out · $5.40");
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

function sseResponse(chunks: unknown[]): Response {
	const body = chunks
		.map((chunk) =>
			chunk === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(chunk)}\n\n`,
		)
		.join("");
	return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

describe("createUsageTrackingFetch", () => {
	test("reports billed cost once after the stream ends, not per chunk", async () => {
		const seen: Array<{ promptTokens: number; costUsd?: number }> = [];
		let probe: Promise<void> | undefined;
		const tracked = createUsageTrackingFetch(
			(usage) => seen.push({ promptTokens: usage.promptTokens, costUsd: usage.costUsd }),
			async () =>
				sseResponse([
					{ choices: [{ delta: { content: "hi" } }] },
					{
						choices: [{ delta: {}, finish_reason: "stop" }],
						usage: {
							prompt_tokens: 0,
							completion_tokens: 0,
							total_tokens: 0,
							cost: 0,
						},
					},
					{
						choices: [{ delta: {}, finish_reason: "stop" }],
						usage: {
							prompt_tokens: 80_000,
							completion_tokens: 4_000,
							total_tokens: 84_000,
							cost: 5.4,
						},
					},
					"[DONE]",
				]),
			undefined,
			(done) => {
				probe = done;
			},
		);
		const res = await tracked("https://openrouter.ai/api/v1/chat/completions");
		await res.text();
		await probe;
		expect(seen).toEqual([{ promptTokens: 80_000, costUsd: 5.4 }]);
	});
});
