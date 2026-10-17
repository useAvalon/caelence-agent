import { describe, expect, test } from "bun:test";
import {
	calibratePlot,
	calibrationResidual,
	computeSwings,
	dataToScreen,
	discoverDrawTool,
	wantsChartDraw,
} from "./chart.ts";

describe("chart drawing", () => {
	test("recorded screenshot calibration residual is under 1% of plot height", () => {
		const plot = { x: 80, y: 40, w: 640, h: 400 };
		const labels = [
			{ text: "200", x: 40, y: 40 },
			{ text: "150", x: 40, y: 140 },
			{ text: "100", x: 40, y: 240 },
			{ text: "50", x: 40, y: 340 },
			{ text: "0", x: 40, y: 440 },
			{ text: "Jan", x: 80, y: 450 },
			{ text: "Mar", x: 400, y: 450 },
			{ text: "May", x: 720, y: 450 },
		];
		const calib = calibratePlot(labels, plot);
		expect(calib).toBeTruthy();
		if (!calib) return;
		const samples = [
			{ index: 0, price: 50, x: 80, y: 340 },
			{ index: 1, price: 150, x: 400, y: 140 },
			{ index: 2, price: 200, x: 720, y: 40 },
		];
		const residual = calibrationResidual(calib, samples);
		expect(residual).toBeLessThan(plot.h * 0.01);
		const point = dataToScreen(calib, 0, 50);
		expect(Math.abs(point.y - 340)).toBeLessThan(plot.h * 0.01);
	});

	test("swings and tool discovery stay generic", () => {
		const swings = computeSwings(
			[
				{ high: 10, low: 8, close: 9 },
				{ high: 12, low: 9, close: 11 },
				{ high: 11, low: 7, close: 8 },
				{ high: 18, low: 10, close: 14 },
				{ high: 13, low: 9, close: 10 },
				{ high: 12, low: 6, close: 8 },
				{ high: 14, low: 11, close: 12 },
			],
			1,
		);
		expect(swings.length).toBeGreaterThan(0);
		expect(discoverDrawTool("button Trend Line", "draw tool: trend line")).toContain("trend");
		expect(wantsChartDraw("draw a trendline on the chart", "canvas plot")).toBe(true);
	});
});
