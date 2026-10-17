import { describe, expect, test } from "bun:test";
import { createBerryTools } from "./berry-tools.ts";
import { filterBerryToolsForTurn, wrapBerryTurnMessage } from "./berry-turn.ts";

describe("berry turn modes", () => {
	test("conversation wrap mentions conversation", () => {
		expect(wrapBerryTurnMessage("hello", true)).toContain("conversation mode");
		expect(wrapBerryTurnMessage("hello", true)).toContain("conversational");
		expect(wrapBerryTurnMessage("hello", true)).toContain("same language as the user");
	});

	test("autonomous wrap mentions autonomous", () => {
		expect(wrapBerryTurnMessage("hello", false)).toContain("autonomous mode");
	});

	test("filters open_search in conversation mode on berry", () => {
		const prev = process.env.HARNESS_BERRY;
		process.env.HARNESS_BERRY = "1";
		const names = filterBerryToolsForTurn(
			createBerryTools(undefined, { includeSearch: true }),
			true,
		).map((t) => t.name);
		expect(names).not.toContain("open_search");
		process.env.HARNESS_BERRY = prev;
	});

	test("keeps open_search in autonomous mode on berry", () => {
		const prev = process.env.HARNESS_BERRY;
		process.env.HARNESS_BERRY = "1";
		const names = filterBerryToolsForTurn(
			createBerryTools(undefined, { includeSearch: true }),
			false,
		).map((t) => t.name);
		expect(names).toContain("open_search");
		process.env.HARNESS_BERRY = prev;
	});
});
