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

	test("drops Router from Auto labels", () => {
		const names = parseLiveTargetNames({
			data: [
				{ id: "openrouter/auto", name: "OpenRouter: Auto Router" },
				{ id: "openrouter/auto-beta", name: "Auto Router Beta" },
			],
		});
		expect(names.get("openrouter/auto")).toBe("Auto");
		expect(names.get("openrouter/auto-beta")).toBe("Auto beta");
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

	test("does not hint Auto Router on Auto", () => {
		const items = modelPickerItems(
			"openrouter/auto",
			new Map([
				["openrouter/auto", "Auto Router"],
				["openrouter/auto-beta", "Auto Router Beta"],
			]),
		);
		expect(items.find((item) => item.id === "openrouter/auto")).toEqual({
			id: "openrouter/auto",
			label: "Auto",
		});
		expect(items.find((item) => item.id === "openrouter/auto-beta")).toEqual({
			id: "openrouter/auto-beta",
			label: "Auto beta",
		});
	});
});
