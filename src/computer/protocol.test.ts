import { describe, expect, test } from "bun:test";
import { parseBridgeEnvelope } from "./protocol.ts";

describe("computer protocol", () => {
	test("accepts a known envelope", () => {
		const parsed = parseBridgeEnvelope({
			v: 1,
			id: "a1",
			kind: "ax.press",
			payload: { ref: "n2" },
		});
		expect("kind" in parsed && parsed.kind === "ax.press").toBe(true);
	});

	test("accepts takeover kinds", () => {
		const parsed = parseBridgeEnvelope({
			v: 1,
			id: "t1",
			kind: "takeover.request",
			payload: { summary: "Draw", estimateMs: 1000 },
		});
		expect("kind" in parsed && parsed.kind === "takeover.request").toBe(true);
	});

	test("rejects unknown kinds instead of crashing", () => {
		const parsed = parseBridgeEnvelope({ v: 1, id: "a1", kind: "explode", payload: {} });
		expect("code" in parsed && parsed.code).toBe("unknown_kind");
	});
});
