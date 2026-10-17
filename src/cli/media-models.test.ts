import { describe, expect, test } from "bun:test";
import { defaultSpeechVoice, normalizeSpeechModelId } from "./media-models.ts";

describe("speech models", () => {
	test("remaps deprecated OpenAI TTS ids", () => {
		expect(normalizeSpeechModelId("openai/gpt-4o-mini-tts-2025-12-15")).toBe(
			"mistralai/voxtral-mini-tts-2603",
		);
	});

	test("voxtral default voice", () => {
		expect(defaultSpeechVoice("mistralai/voxtral-mini-tts-2603")).toBe("en_paul_neutral");
	});
});
