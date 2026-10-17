import { readSiteNote, writeSiteNote } from "./browser/repeat.ts";
import { nativeBridge } from "./native/client.ts";
import { runTakeover } from "./takeover.ts";

export interface OhlcvBar {
	high: number;
	low: number;
	close: number;
	open?: number;
}

export interface Swing {
	index: number;
	price: number;
	kind: "high" | "low";
}

export interface PlotCalib {
	left: number;
	right: number;
	top: number;
	bottom: number;
	i0: number;
	i1: number;
	v0: number;
	v1: number;
	logY: boolean;
}

export function computeSwings(bars: readonly OhlcvBar[], lookback = 3): Swing[] {
	const swings: Swing[] = [];
	for (let i = lookback; i < bars.length - lookback; i++) {
		const high = bars[i]?.high ?? 0;
		const low = bars[i]?.low ?? 0;
		let isHigh = true;
		let isLow = true;
		for (let j = i - lookback; j <= i + lookback; j++) {
			if (j === i) continue;
			if ((bars[j]?.high ?? 0) >= high) isHigh = false;
			if ((bars[j]?.low ?? Number.POSITIVE_INFINITY) <= low) isLow = false;
		}
		if (isHigh) swings.push({ index: i, price: high, kind: "high" });
		if (isLow) swings.push({ index: i, price: low, kind: "low" });
	}
	return swings;
}

export function parsePriceLabel(text: string): number | undefined {
	const cleaned = text.replace(/[, ]/g, "").replace(/^[^\d-]+/, "");
	const value = Number(cleaned);
	return Number.isFinite(value) ? value : undefined;
}

export function calibratePlot(
	labels: Array<{ text: string; x: number; y: number }>,
	plot: { x: number; y: number; w: number; h: number },
): PlotCalib | undefined {
	const yLabels = labels
		.map((row) => ({ y: row.y, v: parsePriceLabel(row.text) }))
		.filter((row): row is { y: number; v: number } => row.v !== undefined)
		.sort((a, b) => a.y - b.y);
	const xLabels = labels.filter((row) => row.y > plot.y + plot.h * 0.85).sort((a, b) => a.x - b.x);
	if (yLabels.length < 2) return undefined;
	const top = yLabels[0];
	const bottom = yLabels[yLabels.length - 1];
	if (!top || !bottom) return undefined;
	const logY =
		top.v > 0 &&
		bottom.v > 0 &&
		Math.abs(Math.log(top.v) - Math.log(bottom.v)) > 0 &&
		ratioLooksLog(yLabels);
	const i0 = 0;
	const i1 = Math.max(xLabels.length - 1, 1);
	return {
		left: plot.x,
		right: plot.x + plot.w,
		top: plot.y,
		bottom: plot.y + plot.h,
		i0,
		i1,
		v0: bottom.v,
		v1: top.v,
		logY,
	};
}

function ratioLooksLog(labels: Array<{ y: number; v: number }>): boolean {
	if (labels.length < 3) return false;
	const ys = labels.map((row) => row.y);
	const logs = labels.map((row) => Math.log(row.v));
	const lin = labels.map((row) => row.v);
	return residual(ys, logs) < residual(ys, lin) * 0.6;
}

function residual(xs: number[], ys: number[]): number {
	const n = xs.length;
	const mx = xs.reduce((a, b) => a + b, 0) / n;
	const my = ys.reduce((a, b) => a + b, 0) / n;
	let num = 0;
	let den = 0;
	for (let i = 0; i < n; i++) {
		num += (xs[i]! - mx) * (ys[i]! - my);
		den += (xs[i]! - mx) ** 2;
	}
	const slope = den === 0 ? 0 : num / den;
	const intercept = my - slope * mx;
	let sum = 0;
	for (let i = 0; i < n; i++) {
		sum += (ys[i]! - (slope * xs[i]! + intercept)) ** 2;
	}
	return Math.sqrt(sum / n);
}

export function dataToScreen(
	calib: PlotCalib,
	index: number,
	price: number,
): { x: number; y: number } {
	const t = (index - calib.i0) / Math.max(calib.i1 - calib.i0, 1);
	const x = calib.left + t * (calib.right - calib.left);
	if (calib.logY && price > 0 && calib.v0 > 0 && calib.v1 > 0) {
		const u =
			(Math.log(price) - Math.log(calib.v0)) / (Math.log(calib.v1) - Math.log(calib.v0) || 1);
		return { x, y: calib.bottom - u * (calib.bottom - calib.top) };
	}
	const u = (price - calib.v0) / (calib.v1 - calib.v0 || 1);
	return { x, y: calib.bottom - u * (calib.bottom - calib.top) };
}

export function calibrationResidual(
	calib: PlotCalib,
	samples: Array<{ index: number; price: number; x: number; y: number }>,
): number {
	let sum = 0;
	for (const sample of samples) {
		const point = dataToScreen(calib, sample.index, sample.price);
		sum += (point.y - sample.y) ** 2;
	}
	return Math.sqrt(sum / Math.max(samples.length, 1));
}

export function discoverDrawTool(world: string, notes = ""): string | undefined {
	const hay = `${notes}\n${world}`.toLowerCase();
	const names = [
		"trend line",
		"trendline",
		"ray",
		"horizontal line",
		"fib retracement",
		"polyline",
	];
	return names.find((name) => hay.includes(name));
}

export function shapesFromSwings(swings: Swing[]): Array<{ from: Swing; to: Swing }> {
	const lines: Array<{ from: Swing; to: Swing }> = [];
	for (let i = 1; i < swings.length; i++) {
		const from = swings[i - 1];
		const to = swings[i];
		if (from && to) lines.push({ from, to });
	}
	return lines.slice(0, 4);
}

export async function drawChartShapes(input: {
	world: string;
	url?: string;
	plot: { x: number; y: number; w: number; h: number };
	labels: Array<{ text: string; x: number; y: number }>;
	bars?: OhlcvBar[];
	app?: string;
}): Promise<{ ok: boolean; summary: string }> {
	const notes = input.url ? (readSiteNote(input.url) ?? "") : "";
	const calib = calibratePlot(input.labels, input.plot);
	if (!calib) return { ok: false, summary: "I couldn't read the price scale." };
	const bars = input.bars?.length ? input.bars : syntheticBarsFromLabels(input.labels);
	const swings = computeSwings(bars);
	const shapes = shapesFromSwings(swings);
	if (shapes.length === 0) return { ok: false, summary: "No swings to draw." };
	const tool = discoverDrawTool(input.world, notes);
	const result = await runTakeover(
		nativeBridge,
		{
			summary: "Draw on the open chart. Move the mouse to stop.",
			estimateMs: 8_000 + shapes.length * 1_200,
			app: input.app,
		},
		async (hid) => {
			if (tool) {
				await nativeBridge.pressName(tool).catch(() => undefined);
			}
			for (const shape of shapes) {
				const a = dataToScreen(calib, shape.from.index, shape.from.price);
				const b = dataToScreen(calib, shape.to.index, shape.to.price);
				await hid.drag(a, b);
				await hid.key("escape");
			}
		},
	);
	if (result.skipped) return { ok: true, summary: "Skipped drawing." };
	if (result.aborted) return { ok: false, summary: "Stopped drawing." };
	if (input.url && tool) writeSiteNote(input.url, `draw tool: ${tool}`);
	return { ok: true, summary: "The lines are on the chart." };
}

function syntheticBarsFromLabels(
	labels: Array<{ text: string; x: number; y: number }>,
): OhlcvBar[] {
	const prices = labels
		.map((row) => parsePriceLabel(row.text))
		.filter((v): v is number => v !== undefined);
	if (prices.length < 4) return [];
	return prices.map((price, i) => ({
		open: price,
		high: price * (i % 2 === 0 ? 1.01 : 1.004),
		low: price * (i % 2 === 0 ? 0.99 : 0.996),
		close: price,
	}));
}

export function wantsChartDraw(task: string, world: string): boolean {
	const hay = `${task}\n${world}`;
	return (
		/\b(draw|trend.?line|fib|horizontal|ray)\b/i.test(task) &&
		/\b(chart|plot|candle|ohlc|canvas)\b/i.test(hay)
	);
}
