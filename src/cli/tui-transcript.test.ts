import { describe, expect, test } from "bun:test";
import type { StreamLine } from "./tui-stream.ts";
import {
	estimateStreamLineRows,
	summarizeTurnTools,
	takeLinesForRowBudget,
} from "./tui-transcript.ts";

describe("tui transcript layout", () => {
	test("summarizes tool names for a completed turn", () => {
		expect(
			summarizeTurnTools([
				{ name: "read_file", status: "ok" },
				{ name: "read_file", status: "ok" },
				{ name: "exec", status: "fail" },
			]),
		).toBe("Tools: read_file×2, exec");
	});

	test("keeps newest lines within a wrapped row budget", () => {
		const lines: StreamLine[] = [
			{ key: "1", type: "user", text: "first question with a longer prompt" },
			{ key: "2", type: "assistant", text: "first answer" },
			{ key: "3", type: "user", text: "second question" },
			{ key: "4", type: "assistant", text: "second answer that should stay visible" },
		];
		const width = 24;
		const budget =
			estimateStreamLineRows(lines[3]!, width) + estimateStreamLineRows(lines[2]!, width);
		const shown = takeLinesForRowBudget(lines, width, budget);
		expect(shown.map((line) => line.key)).toEqual(["3", "4"]);
	});
});
