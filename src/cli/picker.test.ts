import { describe, expect, test } from "bun:test";
import type { Session } from "../core/session.ts";
import { modelPickerItems } from "./models.ts";
import {
	inkPickerNav,
	matchListedSession,
	paintPickerLine,
	pickerPage,
	pickerVisibleRows,
	relativeTime,
	sessionPickerItems,
	stepIndex,
} from "./picker.ts";

function session(partial: Partial<Session> & Pick<Session, "id" | "title">): Session {
	return {
		createdAt: "2026-09-14T10:00:00.000Z",
		updatedAt: "2026-09-14T12:00:00.000Z",
		messages: [],
		...partial,
	};
}

describe("session picker", () => {
	const sessions = [
		session({ id: "ses_a", title: "Fix the nav overlay" }),
		session({ id: "ses_b", title: "Add billing copy" }),
	];

	test("labels by title, not id", () => {
		const items = sessionPickerItems(sessions);
		expect(items.map((item) => item.label)).toEqual(["Fix the nav overlay", "Add billing copy"]);
		expect(items.some((item) => item.label.includes("ses_"))).toBe(false);
	});

	test("matches 1-based index and title", () => {
		expect(matchListedSession(sessions, "2")?.id).toBe("ses_b");
		expect(matchListedSession(sessions, "billing")?.title).toBe("Add billing copy");
		expect(matchListedSession(sessions, "")).toBeUndefined();
	});

	test("relativeTime uses the stored timestamp", () => {
		expect(relativeTime("2026-09-14T11:00:00.000Z", Date.parse("2026-09-14T12:10:00.000Z"))).toBe(
			"1 h ago",
		);
	});
});

describe("model picker", () => {
	test("includes the current model even if it is not in the catalog", () => {
		const items = modelPickerItems("acme/custom-1");
		expect(items[0]?.id).toBe("acme/custom-1");
		expect(items.some((item) => item.id === "~x-ai/grok-latest")).toBe(true);
	});
});

describe("stepIndex", () => {
	test("wraps", () => {
		expect(stepIndex(0, 3, -1)).toBe(2);
		expect(stepIndex(2, 3, 1)).toBe(0);
	});
});

describe("pickerPage", () => {
	test("keeps the selection in a short window", () => {
		const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
		expect(pickerPage(items, 0, 4)).toEqual({ items: ["a", "b", "c", "d"], offset: 0 });
		expect(pickerPage(items, 9, 4)).toEqual({ items: ["g", "h", "i", "j"], offset: 6 });
		expect(pickerPage(items, 5, 4)).toEqual({ items: ["d", "e", "f", "g"], offset: 3 });
	});
});

describe("pickerVisibleRows", () => {
	test("uses the terminal height instead of a fixed 8-row window", () => {
		expect(pickerVisibleRows(12)).toBe(6);
		expect(pickerVisibleRows(40)).toBe(34);
		expect(pickerVisibleRows(4)).toBe(4);
	});
});

describe("inkPickerNav", () => {
	const blank = {
		escape: false,
		upArrow: false,
		downArrow: false,
		tab: false,
		shift: false,
		return: false,
	};

	test("moves on arrows even when escape is also set", () => {
		expect(inkPickerNav({ ...blank, escape: true, upArrow: true })).toBe(-1);
		expect(inkPickerNav({ ...blank, escape: true, downArrow: true })).toBe(1);
	});

	test("cancels on a bare escape", () => {
		expect(inkPickerNav({ ...blank, escape: true })).toBe("esc");
	});
});

describe("paintPickerLine", () => {
	test("pads a short connect hint over a longer leftover", () => {
		const previous = paintPickerLine("  Neon · on · disconnect", 28);
		const next = paintPickerLine("  Neon · connect", 28);
		expect(previous).toContain("disconnect");
		expect(next).toHaveLength(28);
		expect(next).toContain("connect");
		expect(next).not.toContain("disconnect");
		expect(next).not.toContain("connectnect");
	});
});
