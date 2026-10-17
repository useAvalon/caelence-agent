import { describe, expect, test } from "bun:test";
import { isPlaceholderUserMessage } from "./berry-voice-input.ts";

describe("isPlaceholderUserMessage", () => {
	test("dots and ellipsis", () => {
		expect(isPlaceholderUserMessage("..")).toBe(true);
		expect(isPlaceholderUserMessage("...")).toBe(true);
		expect(isPlaceholderUserMessage("…")).toBe(true);
		expect(isPlaceholderUserMessage(" . . ")).toBe(true);
	});

	test("real utterances", () => {
		expect(isPlaceholderUserMessage("hi")).toBe(false);
		expect(isPlaceholderUserMessage("what is the weather")).toBe(false);
	});

	test("drops quoted news-style ASR junk", () => {
		expect(isPlaceholderUserMessage('"MBC 뉴스 이덕영입니다"')).toBe(true);
		expect(isPlaceholderUserMessage("what do you think about this job")).toBe(false);
	});
});
