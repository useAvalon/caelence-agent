import { describe, expect, test } from "bun:test";
import { detectLightTerminalBackground, luminanceFromOsc11 } from "./tui-terminal-probe.ts";

describe("tui terminal probe", () => {
	test("parses OSC 11 rgb background", () => {
		expect(luminanceFromOsc11("rgb:ffff/ffff/ffff")).toBeCloseTo(1, 1);
		expect(luminanceFromOsc11("rgb:0000/0000/0000")).toBeCloseTo(0, 1);
	});

	test("parses hex background", () => {
		expect(luminanceFromOsc11("#ffffff")).toBeCloseTo(1, 1);
		expect(luminanceFromOsc11("1a1a1a")).toBeCloseTo(0.1, 1);
	});

	test("defaults to light palette when detection is inconclusive", async () => {
		expect(await detectLightTerminalBackground({})).toBe(true);
		expect(await detectLightTerminalBackground({ CAELENCE_LIGHT_TERMINAL: "0" })).toBe(false);
	});
});
