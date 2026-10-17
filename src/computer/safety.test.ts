import { describe, expect, test } from "bun:test";
import {
	actionIsDisruptive,
	actionNeedsConfirm,
	httpNeedsConfirm,
	mustAskUser,
	shellNeedsConfirm,
} from "./safety.ts";

describe("computer safety", () => {
	test("pauses publish-like labels", () => {
		expect(actionNeedsConfirm({ label: "Click Post" })).toBe(true);
		expect(actionNeedsConfirm({ label: "Open templates", risky: false })).toBe(false);
		expect(actionNeedsConfirm({ label: "Start a post" })).toBe(false);
		expect(actionNeedsConfirm({ label: "create a post" })).toBe(false);
		expect(actionNeedsConfirm({ label: "Post textbox" })).toBe(false);
		expect(actionNeedsConfirm({ label: "Publishing", name: "Post" })).toBe(true);
	});

	test("blocks destructive shell and mutating http", () => {
		expect(shellNeedsConfirm("rm -rf /tmp/x")).toBe(true);
		expect(httpNeedsConfirm("POST")).toBe(true);
		expect(mustAskUser("type the password")).toBe(true);
	});

	test("blocks print, close, and shortcuts", () => {
		expect(actionIsDisruptive({ kind: "click", label: "Print" })).toBe(true);
		expect(actionIsDisruptive({ kind: "click", label: "Luk" })).toBe(true);
		expect(actionIsDisruptive({ kind: "press", label: "shortcut", key: "cmd+p" })).toBe(true);
		expect(actionIsDisruptive({ kind: "press", label: "newline", key: "enter" })).toBe(false);
	});
});
