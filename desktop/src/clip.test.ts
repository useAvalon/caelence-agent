import { describe, expect, test } from "bun:test";
import { clipNeedsExpand } from "./clip.ts";

describe("clipNeedsExpand", () => {
	test("ignores a sliver of the last line", () => {
		expect(clipNeedsExpand(108, 99, 22)).toBe(false);
	});

	test("expands when more than a line is hidden", () => {
		expect(clipNeedsExpand(180, 99, 22)).toBe(true);
	});

	test("does not expand when content fits", () => {
		expect(clipNeedsExpand(80, 99, 22)).toBe(false);
	});
});
