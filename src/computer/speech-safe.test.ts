import { describe, expect, test } from "bun:test";
import { forSpeech, looksLikeAgentInternals, spokenSiteName } from "./speech-safe.ts";

describe("speech-safe", () => {
	test("says the site, not the URL", () => {
		expect(spokenSiteName("https://www.linkedin.com/feed/?shareActive=true")).toBe("Linkedin");
		expect(forSpeech("Opening https://www.linkedin.com/feed/ now.")).toBe("Opening Linkedin now.");
	});

	test("does not speak tool dumps", () => {
		expect(looksLikeAgentInternals('observe({"mode":"browser"})')).toBe(true);
		expect(forSpeech('URL https://linkedin.com\nn1 button "Home"')).toBeUndefined();
	});

	test("does not speak AppleScript", () => {
		const script = `tell application "Google Chrome" to open location "https://www.notion.so"\nend tell\ndelay 4\ntell application "System Events"\nkeystroke "hello"\nend tell`;
		expect(looksLikeAgentInternals(script)).toBe(true);
		expect(forSpeech(script)).toBeUndefined();
	});
});
