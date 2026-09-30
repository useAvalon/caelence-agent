import { describe, expect, test } from "bun:test";
import {
	CAELENCE_LIGHT_THEME,
	CAELENCE_THEME,
	PLAIN_LIGHT_THEME,
	PLAIN_THEME,
	resolveTheme,
	terminalPrefersLightBackground,
} from "./theme.ts";

describe("theme", () => {
	test("defaults to caelence on dark terminals", () => {
		expect(resolveTheme(undefined, { COLORFGBG: "7;0" }).brand).toBe(CAELENCE_THEME.brand);
		expect(resolveTheme("plain", { COLORFGBG: "7;0" }).name).toBe(PLAIN_THEME.name);
		expect(
			resolveTheme({ ...CAELENCE_THEME, danger: "#ff0000" }, { COLORFGBG: "7;0" }).danger,
		).toBe("#ff0000");
	});

	test("uses light palette when COLORFGBG reports a pale background", () => {
		expect(resolveTheme(undefined, { COLORFGBG: "0;15" }).ink).toBe(CAELENCE_LIGHT_THEME.ink);
		expect(resolveTheme("plain", { COLORFGBG: "0;15" }).ink).toBe(PLAIN_LIGHT_THEME.ink);
	});

	test("detects light background from COLORFGBG", () => {
		expect(terminalPrefersLightBackground({ COLORFGBG: "0;15" })).toBe(true);
		expect(terminalPrefersLightBackground({ COLORFGBG: "7;0" })).toBe(false);
		expect(terminalPrefersLightBackground({})).toBe(false);
	});

	test("honors CAELENCE_LIGHT_TERMINAL override", () => {
		expect(terminalPrefersLightBackground({ CAELENCE_LIGHT_TERMINAL: "1", COLORFGBG: "7;0" })).toBe(
			true,
		);
		expect(
			terminalPrefersLightBackground({ CAELENCE_LIGHT_TERMINAL: "0", COLORFGBG: "0;15" }),
		).toBe(false);
		expect(resolveTheme(undefined, { CAELENCE_LIGHT_TERMINAL: "0", COLORFGBG: "0;15" }).ink).toBe(
			CAELENCE_THEME.ink,
		);
		expect(resolveTheme(undefined, { CAELENCE_LIGHT_TERMINAL: "1", COLORFGBG: "7;0" }).ink).toBe(
			CAELENCE_LIGHT_THEME.ink,
		);
	});

	test("uses instrument blue instead of brand green", () => {
		expect(CAELENCE_THEME.brand).toBe("#6e93b8");
		expect(CAELENCE_THEME.action).toBe("#6e93b8");
		expect(CAELENCE_THEME.done).toBe("#6e93b8");
		expect(PLAIN_THEME.brand).toBe("blue");
	});
});
