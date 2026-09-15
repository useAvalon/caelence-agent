import { describe, expect, test } from "bun:test";
import { audioFormatFromMime, canUseWebMic, dictationErrorMessage } from "./dictation.ts";

describe("dictation helpers", () => {
	test("maps recorder mime types to OpenRouter formats", () => {
		expect(audioFormatFromMime("audio/webm;codecs=opus")).toBe("webm");
		expect(audioFormatFromMime("audio/mp4")).toBe("mp4");
		expect(audioFormatFromMime("audio/wav")).toBe("wav");
	});

	test("names a blocked microphone", () => {
		expect(dictationErrorMessage({ name: "NotAllowedError" })).toBe(
			"Microphone is blocked. Allow it for Caelence agent, then try again.",
		);
	});

	test("treats a missing webview mic as unavailable, not a hard stop", () => {
		expect(canUseWebMic()).toBe(
			typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
		);
	});
});
