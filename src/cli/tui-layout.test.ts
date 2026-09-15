import { describe, expect, test } from "bun:test";
import {
	clipLabel,
	sidebarWidth,
	takeVisibleLines,
	tuiChromeRows,
	visibleTranscriptCount,
} from "./tui-layout.ts";

describe("tui layout", () => {
	test("shows a session rail only when the terminal is wide enough", () => {
		expect(sidebarWidth(80)).toBe(0);
		expect(sidebarWidth(88)).toBe(26);
	});

	test("keeps a minimum transcript viewport", () => {
		expect(visibleTranscriptCount(12, 20)).toBe(3);
		expect(visibleTranscriptCount(40, 10)).toBe(30);
	});

	test("clips to the newest lines", () => {
		expect(takeVisibleLines(["a", "b", "c", "d"], 2)).toEqual(["c", "d"]);
	});

	test("clips session titles to the rail", () => {
		expect(clipLabel("Billing copy for the new site", 12)).toBe("Billing cop…");
	});

	test("counts chrome for approval and pickers", () => {
		expect(tuiChromeRows({ approval: false, pickerCount: 0, slashCount: 0 })).toBe(5);
		expect(tuiChromeRows({ approval: true, pickerCount: 3, slashCount: 0 })).toBe(14);
	});
});
