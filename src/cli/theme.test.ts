import { describe, expect, test } from "bun:test";
import { CAELENCE_THEME, PLAIN_THEME, resolveTheme } from "./theme.ts";

describe("theme", () => {
	test("defaults to caelence", () => {
		expect(resolveTheme(undefined).brand).toBe(CAELENCE_THEME.brand);
		expect(resolveTheme("plain").name).toBe(PLAIN_THEME.name);
		expect(resolveTheme({ ...CAELENCE_THEME, danger: "#ff0000" }).danger).toBe("#ff0000");
	});
});
