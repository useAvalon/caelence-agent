import { describe, expect, test } from "bun:test";
import { applyTextInputKey } from "./tui-text-input.ts";

describe("tui text input", () => {
	test("inserts, moves, deletes, and submits", () => {
		expect(applyTextInputKey("ab", 2, "c", {})).toEqual({ value: "abc", cursor: 3 });
		expect(applyTextInputKey("abc", 3, "", { backspace: true })).toEqual({
			value: "ab",
			cursor: 2,
		});
		expect(applyTextInputKey("abc", 1, "", { delete: true })).toEqual({ value: "ac", cursor: 1 });
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
});
