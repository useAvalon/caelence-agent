import { describe, expect, test } from "bun:test";
import { modelPickerItems } from "./models.ts";
import { parseLiveTargetNames } from "./openrouter-live.ts";

describe("parseLiveTargetNames", () => {
	test("reads alias_target names the way OpenRouter sends them", () => {
		const names = parseLiveTargetNames({
			data: [
				{
					id: "~x-ai/grok-latest",
					name: "xAI: Grok Latest",
					alias_target: { slug: "x-ai/grok-4.6", name: "xAI: Grok 4.6" },
				},
				{
					id: "openai/gpt-5.6-sol",
					name: "OpenAI: GPT-5.6 Sol",
				},
			],
		});
		expect(names.get("~x-ai/grok-latest")).toBe("Grok 4.6");
		expect(names.get("openai/gpt-5.6-sol")).toBe("GPT-5.6 Sol");
	});
});

describe("model picker live names", () => {
	test("uses the OpenRouter target as the hint, not the slug", () => {
		const items = modelPickerItems(
			"~x-ai/grok-latest",
			new Map([["~x-ai/grok-latest", "Grok 4.6"]]),
		);
		const grok = items.find((item) => item.id === "~x-ai/grok-latest");
		expect(grok?.label).toBe("Grok latest");
		expect(grok?.hint).toBe("Grok 4.6");
	});
});
