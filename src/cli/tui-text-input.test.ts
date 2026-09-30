import { describe, expect, test } from "bun:test";
import { applyTextInputKey } from "./tui-text-input.ts";

describe("tui text input", () => {
	test("inserts, moves, deletes, and submits", () => {
		expect(applyTextInputKey("ab", 2, "c", {})).toEqual({ value: "abc", cursor: 3 });
		expect(applyTextInputKey("abc", 3, "", { backspace: true })).toEqual({
			value: "ab",
			cursor: 2,
		});
		expect(applyTextInputKey("abc", 3, "", { delete: true })).toEqual({
			value: "ab",
			cursor: 2,
		});
		expect(applyTextInputKey("abc", 3, "", { leftArrow: true })).toEqual({
			value: "abc",
			cursor: 2,
		});
		expect(applyTextInputKey("hi", 2, "", { return: true })).toEqual({
			value: "hi",
			cursor: 2,
			submit: true,
		});
		expect(applyTextInputKey("hi", 2, "", { upArrow: true })).toBeUndefined();
	});

	test("treats terminal delete bytes as backspace", () => {
		expect(applyTextInputKey("abc", 3, "\x7f", {})).toEqual({ value: "ab", cursor: 2 });
		expect(applyTextInputKey("abc", 2, "\b", {})).toEqual({ value: "ac", cursor: 1 });
	});

	test("flattens pasted newlines to spaces", () => {
		expect(applyTextInputKey("a", 1, "b\nc", {})).toEqual({ value: "ab c", cursor: 4 });
	});
});
