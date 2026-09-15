import { describe, expect, test } from "bun:test";
import { integrationMatches } from "./integration-search.ts";

describe("integrationMatches", () => {
	test("matches a name prefix and ignores description copy", () => {
		expect(integrationMatches("Canva", "ca")).toBe(true);
		expect(integrationMatches("Google Calendar", "ca")).toBe(true);
		expect(integrationMatches("Google Sheets", "ca")).toBe(false);
		expect(integrationMatches("Replicate", "ca")).toBe(false);
		expect(integrationMatches("Google Sheets", "google")).toBe(true);
		expect(integrationMatches("Google Sheets", "sheet")).toBe(true);
	});
});
