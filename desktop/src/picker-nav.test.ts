import { describe, expect, test } from "bun:test";
import { pickerKeyAction, pickerStartIndex, stepIndex } from "./picker-nav";

describe("picker navigation", () => {
	test("wraps arrow steps around the list", () => {
		expect(stepIndex(0, 3, -1)).toBe(2);
		expect(stepIndex(2, 3, 1)).toBe(0);
		expect(stepIndex(1, 3, 1)).toBe(2);
	});

	test("maps list keys away from the composer", () => {
		expect(pickerKeyAction("ArrowDown")).toEqual({ type: "move", delta: 1 });
		expect(pickerKeyAction("ArrowUp")).toEqual({ type: "move", delta: -1 });
		expect(pickerKeyAction("Tab")).toEqual({ type: "move", delta: 1 });
		expect(pickerKeyAction("Tab", true)).toEqual({ type: "move", delta: -1 });
		expect(pickerKeyAction("Enter")).toEqual({ type: "confirm" });
		expect(pickerKeyAction("Escape")).toEqual({ type: "cancel" });
		expect(pickerKeyAction("a")).toEqual({ type: "block" });
		expect(pickerKeyAction("Shift")).toBeNull();
	});

	test("starts on the current value", () => {
		const items = [{ id: "ask" }, { id: "plan" }, { id: "agent" }];
		expect(pickerStartIndex(items, "agent")).toBe(2);
		expect(pickerStartIndex(items, "missing")).toBe(0);
	});
});
