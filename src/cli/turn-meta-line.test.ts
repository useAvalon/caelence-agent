import { describe, expect, test } from "bun:test";
import { formatTurnMetaLine } from "./turn-meta-line.ts";

describe("formatTurnMetaLine", () => {
	test("jev shortcut", () => {
		const line = formatTurnMetaLine({
			kind: "turn_meta",
			routing: "jev_shortcut",
			jevModel: "typesafe/jev-1.13",
			toolName: "open_url",
		});
		expect(line).toContain("Jev");
		expect(line).toContain("open_url");
	});

	test("chat auto label", () => {
		const line = formatTurnMetaLine({
			kind: "turn_meta",
			routing: "chat",
			modelId: "openrouter/auto",
		});
		expect(line).toContain("chat");
		expect(line).toContain("Auto");
	});
});
