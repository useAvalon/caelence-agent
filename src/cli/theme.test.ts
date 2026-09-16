import { describe, expect, test } from "bun:test";
import { CAELENCE_THEME, PLAIN_THEME, resolveTheme } from "./theme.ts";

describe("theme", () => {
	test("defaults to caelence", () => {
		expect(resolveTheme(undefined).brand).toBe(CAELENCE_THEME.brand);
		expect(resolveTheme("plain").name).toBe(PLAIN_THEME.name);
		expect(resolveTheme({ ...CAELENCE_THEME, danger: "#ff0000" }).danger).toBe("#ff0000");
	});

	test("uses instrument blue instead of brand green", () => {
		expect(CAELENCE_THEME.brand).toBe("#6e93b8");
		expect(CAELENCE_THEME.action).toBe("#6e93b8");
		expect(CAELENCE_THEME.done).toBe("#6e93b8");
		expect(PLAIN_THEME.brand).toBe("blue");
	});
});
