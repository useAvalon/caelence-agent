import { describe, expect, test } from "bun:test";
import { composeRefFromSnapshot, refForAction } from "./snapshot-format.ts";

describe("composeRefFromSnapshot", () => {
	test("picks the start-a-post control", () => {
		const snap = [
			"Frontmost app: Arc",
			'n1 button "Home"',
			'n2 button "Start a post"',
			'n3 textbox "What\'s on your mind?"',
		].join("\n");
		expect(composeRefFromSnapshot(snap)).toBe("n2");
	});

	test("reads a bracketed ref from the page snapshot", () => {
		const snap = [
			"URL: https://www.linkedin.com/feed/",
			'[2] button "Start a post"',
			'[4] textbox "Text editor for creating content" (empty editor, focused)',
		].join("\n");
		expect(composeRefFromSnapshot(snap)).toBe("2");
	});

	test("finds an accessibility ref from a name", () => {
		const snap = [
			"Frontmost app: Google Chrome",
			'n2 button "Start a post"',
			'n4 textbox "Search"',
		].join("\n");
		expect(refForAction(snap, { kind: "click", label: "Start a post" })).toBe("n2");
		expect(refForAction(snap, { kind: "click", ref: "2" })).toBe("n2");
	});

	test("does not match a chat composer", () => {
		const snap = [
			"Frontmost app: Arc",
			'n1 textbox "Reply to Claude"',
			'n2 button "Composer"',
		].join("\n");
		expect(composeRefFromSnapshot(snap)).toBeUndefined();
	});
});
