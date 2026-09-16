import { describe, expect, test } from "bun:test";
import { formatSkillInstalls, skillMatches } from "./skill-search.ts";

describe("skillMatches", () => {
	const item = {
		name: "frontend-design",
		source: "anthropics/skills",
		description: "Distinctive UI, typography, motion, and color.",
	};

	test("matches name prefixes and sources", () => {
		expect(skillMatches(item, "")).toBe(true);
		expect(skillMatches(item, "front")).toBe(true);
		expect(skillMatches(item, "anthropics")).toBe(true);
		expect(skillMatches(item, "billing")).toBe(false);
	});

	test("uses description only for longer queries", () => {
		expect(skillMatches(item, "ty")).toBe(false);
		expect(skillMatches(item, "typography")).toBe(true);
	});

	test("formats install counts", () => {
		expect(formatSkillInstalls(891_500)).toBe("891.5K");
		expect(formatSkillInstalls(3_400_000)).toBe("3.4M");
	});
});
