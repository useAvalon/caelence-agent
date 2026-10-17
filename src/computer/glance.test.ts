import { describe, expect, test } from "bun:test";
import { type GlanceWindow, pickGlanceWindow } from "./glance.ts";

const trading: GlanceWindow = {
	owner: "TradingView",
	title: "AAPL",
	id: "10",
	width: 1400,
	height: 900,
	front: false,
};
const berry: GlanceWindow = {
	owner: "CaelenceBerry",
	title: "",
	id: "2",
	width: 320,
	height: 260,
	front: true,
};
const arc: GlanceWindow = {
	owner: "Arc",
	title: "New page",
	id: "8",
	width: 1200,
	height: 800,
	front: false,
};

describe("glance window", () => {
	test("picks the named app even when the berry is in front", () => {
		const picked = pickGlanceWindow(
			[berry, arc, trading],
			"analyze the stock price on my current open tradingview window",
		);
		expect(picked?.id).toBe("10");
	});

	test("uses the front app when the request does not name one", () => {
		const frontArc = { ...arc, front: true };
		expect(pickGlanceWindow([berry, frontArc, trading], "what is on screen")?.owner).toBe("Arc");
	});
});
