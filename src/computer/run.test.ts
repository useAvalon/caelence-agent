import { describe, expect, test } from "bun:test";
import { computerTaskMessage } from "../core/run-turn.ts";
import { extractBrowserApp, extractSiteHint } from "../decisions/screen-shortcut.ts";
import { shouldReuseComposeDraft, shouldUseComputerAgent } from "./run.ts";

describe("computer task gate", () => {
	test("runs computer-use even when speak replies is on", () => {
		expect(shouldUseComputerAgent("Draft a post on LinkedIn about AR", true)).toBe(true);
		expect(shouldUseComputerAgent("What is a binary tree?", true)).toBe(false);
	});

	test("finds the site to attach from on/in phrasing", () => {
		expect(extractSiteHint("Draft a post on LinkedIn about AR")).toContain("linkedin.com");
		expect(extractSiteHint("open chrome go to linkedin write a post")).toContain("linkedin.com");
		expect(extractSiteHint("open Chrome and write a LinkedIn post")).toContain("linkedin.com");
	});

	test("keeps a short retry on the previous screen task", () => {
		const message = computerTaskMessage("in it", [
			{ role: "user", content: "Open Chrome and write a LinkedIn post" },
			{ role: "assistant", content: "The composer is open, but I could not type in it." },
		]);
		expect(shouldUseComputerAgent(message)).toBe(true);
		expect(message).toContain("LinkedIn");
	});

	test("keeps continue on the screen task", () => {
		const message = computerTaskMessage("continue", [
			{ role: "user", content: "Write a LinkedIn post about the weather" },
			{ role: "assistant", content: "Reached the step limit. Say if I should continue." },
		]);
		expect(message).toContain("LinkedIn");
		expect(shouldUseComputerAgent(message)).toBe(true);
	});

	test("do it in notion instead is a new destination, not a type-into-X retry", () => {
		const message = computerTaskMessage("do it in notion instead", [
			{ role: "user", content: "summarize top news on current tab and post on x" },
			{ role: "assistant", content: "Couldn't type into the composer." },
		]);
		expect(extractSiteHint(message)).toContain("notion.com");
		expect(shouldReuseComposeDraft(message, "A football wrap.")).toBe(false);
		expect(shouldUseComputerAgent(message)).toBe(true);
	});

	test("do it on x reuses the last draft at the new destination", () => {
		const message = computerTaskMessage("can you do it on x", [
			{
				role: "user",
				content: "analyze 10 news in current tab and write a page about it in notion",
			},
			{ role: "assistant", content: "The page is in Notion." },
		]);
		expect(extractSiteHint(message)).toContain("x.com");
		expect(shouldReuseComposeDraft(message, "Markets jumped after the Fed held rates.")).toBe(true);
	});

	test("go ahead types the last draft instead of re-reading the tab", () => {
		expect(
			shouldReuseComposeDraft(
				"summarize top news on current tab and post on x\ngo ahead",
				"Top headlines from the tab.",
			),
		).toBe(true);
		expect(shouldReuseComposeDraft("summarize top news and post on x", "Top headlines.")).toBe(
			false,
		);
		expect(shouldReuseComposeDraft("go ahead", "")).toBe(false);
		expect(shouldReuseComposeDraft("try again", "Robinhood Chain is trending.")).toBe(false);
	});

	test("try again stays on the last post task", () => {
		const message = computerTaskMessage("try again", [
			{ role: "user", content: "summarize top news on current tab and post on x" },
			{ role: "assistant", content: "Writing the post" },
		]);
		expect(message).toContain("post on x");
		expect(shouldUseComputerAgent(message)).toBe(true);
		expect(extractSiteHint(message)).toContain("x.com");
	});

	test("go ahead again stays on the post task", () => {
		const message = computerTaskMessage("go ahead again and post", [
			{ role: "user", content: "summarize top news on current tab and post on x" },
			{ role: "assistant", content: "Ready for X." },
		]);
		expect(message).toContain("post on x");
		expect(shouldUseComputerAgent(message)).toBe(true);
		expect(extractSiteHint(message)).toContain("x.com");
	});

	test("uses the named browser instead of whichever is already running", () => {
		expect(extractBrowserApp("open chrome - go to linkedin - write a post")).toBe("Google Chrome");
		expect(extractBrowserApp("in Arc write a LinkedIn post")).toBe("Arc");
		expect(extractBrowserApp("Draft a post on LinkedIn")).toBeUndefined();
	});
});
