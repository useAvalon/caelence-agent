import { describe, expect, test } from "bun:test";
import { pruneSelected, toggleOne, toggleVisible } from "./session-select";

describe("session-select", () => {
	test("toggleOne adds and removes", () => {
		const added = toggleOne(new Set(), "a");
		expect([...added]).toEqual(["a"]);
		expect([...toggleOne(added, "a")]).toEqual([]);
	});

	test("toggleVisible selects and clears the visible set", () => {
		const selected = toggleVisible(new Set(["keep"]), ["a", "b"], false);
		expect([...selected].sort()).toEqual(["a", "b", "keep"]);
		expect([...toggleVisible(selected, ["a", "b"], true)]).toEqual(["keep"]);
	});

	test("pruneSelected drops ids that left the list", () => {
		const prev = new Set(["a", "gone"]);
		const next = pruneSelected(prev, new Set(["a"]));
		expect([...next]).toEqual(["a"]);
		expect(pruneSelected(next, new Set(["a"]))).toBe(next);
	});
});
