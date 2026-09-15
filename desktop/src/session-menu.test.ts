import { describe, expect, test } from "bun:test";
import { clampMenuPosition } from "./session-menu";

describe("session menu", () => {
	test("keeps the menu on screen", () => {
		expect(
			clampMenuPosition(10, 10, { width: 160, height: 80 }, { width: 800, height: 600 }),
		).toEqual({
			x: 10,
			y: 10,
		});
		expect(
			clampMenuPosition(780, 580, { width: 160, height: 80 }, { width: 800, height: 600 }),
		).toEqual({
			x: 632,
			y: 512,
		});
	});
});
