import { describe, expect, test } from "bun:test";
import { sessionMatches, sortSessions } from "./session-search";

describe("sessionMatches", () => {
	test("matches a title or hint", () => {
		const item = { label: "Fix the sidebar", hint: "Yesterday" };
		expect(sessionMatches(item, "")).toBe(true);
		expect(sessionMatches(item, "side")).toBe(true);
		expect(sessionMatches(item, "yester")).toBe(true);
		expect(sessionMatches(item, "memory")).toBe(false);
	});
});

describe("sortSessions", () => {
	test("keeps newest-first or reverses to oldest", () => {
		const items = ["new", "mid", "old"];
		expect(sortSessions(items, "newest")).toEqual(["new", "mid", "old"]);
		expect(sortSessions(items, "oldest")).toEqual(["old", "mid", "new"]);
	});
});
