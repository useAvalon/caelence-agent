import { describe, expect, test } from "bun:test";
import { openRouterDecisionsUrl } from "./openrouter-url.ts";

describe("openRouterDecisionsUrl", () => {
	test("uses openrouter alpha host", () => {
		expect(openRouterDecisionsUrl("https://openrouter.ai/api/v1")).toBe(
			"https://openrouter.ai/api/alpha/decisions",
		);
	});
});
