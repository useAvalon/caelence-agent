import { describe, expect, test } from "bun:test";
import { turnProgressLabel, warmupHeadline } from "./tui-progress.ts";

describe("tui progress", () => {
	test("rotates warmup headlines", () => {
		expect(warmupHeadline(0)).toBe("Thinking");
		expect(warmupHeadline(1)).toBe("Looking this over");
	});

	test("shows warmup before tools or text", () => {
		expect(turnProgressLabel({ tools: [], assistantStarted: false, tick: 0, warmupSeed: 0 })).toBe(
			"Thinking",
		);
	});

	test("shows tool activity while running", () => {
		expect(
			turnProgressLabel({
				tools: [
					{
						callId: "1",
						name: "read_file",
						status: "running",
						preview: "src/index.ts",
					},
				],
				assistantStarted: false,
				tick: 1,
				warmupSeed: 0,
			}),
		).toBe("Reading src/index.ts.");
	});

	test("shows writing once assistant text starts", () => {
		expect(
			turnProgressLabel({
				tools: [],
				assistantStarted: true,
				tick: 2,
				warmupSeed: 0,
			}),
		).toBe("Writing..");
	});
});
