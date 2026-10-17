import { describe, expect, test } from "bun:test";
import { diffSnapshots } from "./diff.ts";

describe("snapshot diff", () => {
	test("returns only added and removed lines when the page barely changed", () => {
		const a = [
			"URL https://example.com",
			'1 button "Save"',
			'2 link "Home"',
			'3 link "Help"',
			'4 textbox "Search"',
		].join("\n");
		const b = [
			"URL https://example.com",
			'1 button "Save"',
			'2 link "Home"',
			'5 link "Docs"',
			'4 textbox "Search"',
		].join("\n");
		const diff = diffSnapshots(a, b);
		expect(diff).toContain("ADDED");
		expect(diff).toContain('5 link "Docs"');
		expect(diff).not.toContain('1 button "Save"');
	});
});
