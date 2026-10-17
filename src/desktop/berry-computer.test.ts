import { describe, expect, test } from "bun:test";
import {
	clampPoint,
	escapeAppleScriptString,
	formatScreenTargets,
	isBrowserChromePoint,
	isBrowserOwner,
	isInsideBrowserFrame,
	labeledLinesToTargets,
	parseWindowList,
	pickBrowserWindow,
	resolveScreenTarget,
	rewriteClickTargets,
	setLastScreenTargets,
	visionRowsToTargets,
} from "./berry-computer.ts";
import { createBerryTools } from "./berry-tools.ts";

describe("berry computer helpers", () => {
	test("escapes AppleScript strings", () => {
		expect(escapeAppleScriptString('say "hi"\\')).toBe('say \\"hi\\"\\\\');
	});

	test("clamps click coordinates", () => {
		expect(clampPoint(10.2, 20.8)).toEqual({ x: 10, y: 21 });
		expect(clampPoint(-9000, 4)).toBeUndefined();
		expect(clampPoint(Number.NaN, 1)).toBeUndefined();
	});

	test("converts retina screenshot pixels to click points", () => {
		expect(rewriteClickTargets("400,200 Start a post\nkeep this", 2, 0, 0)).toBe(
			"200,100 Start a post\nkeep this",
		);
	});

	test("maps Vision boxes to screen points and resolves ids", () => {
		const targets = visionRowsToTargets(
			"L1\t0.25\t0.5\t0.1\t0.1\tSearch templates",
			100,
			200,
			400,
			300,
		);
		expect(targets).toEqual([{ id: "L1", text: "Search templates", x: 220, y: 335 }]);
		expect(formatScreenTargets(targets)).toContain("L1");
		setLastScreenTargets(targets);
		expect(resolveScreenTarget("L1")?.text).toBe("Search templates");
		expect(resolveScreenTarget("search")?.id).toBe("L1");
		expect(labeledLinesToTargets("240,335 Search templates")[0]).toEqual({
			id: "T1",
			text: "Search templates",
			x: 240,
			y: 335,
		});
	});

	test("rejects clicks in the browser address bar", () => {
		const frame = { x: 620, y: 179, width: 1040, height: 773 };
		expect(isBrowserChromePoint(700, 200, frame)).toBe(true);
		expect(isBrowserChromePoint(800, 420, frame)).toBe(false);
	});

	test("picks the Canva window in Arc instead of Cursor", () => {
		expect(isBrowserOwner("Arc")).toBe(true);
		expect(isBrowserOwner("Cursor")).toBe(false);
		const windows = parseWindowList(
			["10\tCursor\t0\t0\t1400\t900\tsettings", "22\tArc\t40\t40\t1200\t800\tHome - Canva"].join(
				"\n",
			),
		);
		expect(pickBrowserWindow(windows, "canva")?.owner).toBe("Arc");
		expect(pickBrowserWindow(windows)?.title).toBe("Home - Canva");
		const both = parseWindowList(
			[
				"22\tArc\t40\t40\t1200\t800\tHome - Canva",
				"23\tGoogle Chrome\t100\t100\t1200\t800\tCanva",
			].join("\n"),
		);
		expect(pickBrowserWindow(both, "canva chrome")?.owner).toBe("Google Chrome");
		const frame = { x: 100, y: 100, width: 400, height: 300 };
		expect(isInsideBrowserFrame(120, 200, frame)).toBe(true);
		expect(isInsideBrowserFrame(10, 10, frame)).toBe(false);
	});

	test("berry tools stay on the fast open path", () => {
		const names = createBerryTools().map((item) => item.name);
		expect(names).toEqual(["open_url", "open_app"]);
	});
});
