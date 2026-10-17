import { describe, expect, test } from "bun:test";
import {
	checkNavigate,
	extractExplicitSearchQuery,
	extractMentionedSite,
	extractScreenShortcutInput,
	extractSiteHint,
	hostsMentioned,
	messageNeedsCreatedContent,
	planScreenShortcut,
	saysAlreadyOpen,
	stripBerryModeBanner,
} from "../decisions/screen-shortcut.ts";

const extractBerryShortcutInput = extractScreenShortcutInput;

describe("berry jev extract", () => {
	test("open_url from domain", () => {
		const plan = extractBerryShortcutInput("open_url", "open example.com/docs");
		expect(plan?.toolName).toBe("open_url");
		expect(plan?.input.url).toContain("example.com");
	});

	test("open a spoken site name, not nearby words", () => {
		expect(extractBerryShortcutInput("open_url", "can you open example")?.input.url).toBe(
			"https://example.com/",
		);
		expect(extractMentionedSite("open a tab for example")).toBe("https://example.com/");
		expect(extractMentionedSite("go to example in chrome")).toBe("https://example.com/");
		expect(extractMentionedSite("open chrome go to linkedin write a post")).toContain(
			"linkedin.com",
		);
		expect(extractMentionedSite("canva was in chrome")).toBeUndefined();
		expect(extractMentionedSite("canva.com is open in chrome")).toBe("https://canva.com/");
		expect(hostsMentioned("canva.com is open in chrome")).toEqual(["canva.com"]);
		expect(extractMentionedSite("create a new cv template")).toBeUndefined();
		expect(hostsMentioned("canva was in chrome")).toEqual([]);
		expect(hostsMentioned("open example in chrome")).toEqual(["example.com"]);
		expect(saysAlreadyOpen("canva.com is open in chrome")).toBe(true);
	});

	test("open_search only with explicit phrasing", () => {
		const plan = extractBerryShortcutInput("open_search", "search for example docs");
		expect(plan?.toolName).toBe("open_search");
		expect(plan?.input.query).toBe("example docs");
	});

	test("open_search route does not treat questions as queries", () => {
		expect(extractBerryShortcutInput("open_search", "what is the capital of France")).toBeNull();
		expect(extractExplicitSearchQuery("what is the capital of France")).toBeNull();
	});

	test("open_app from phrase", () => {
		const plan = extractBerryShortcutInput("open_app", "open Safari");
		expect(plan?.input.name).toBe("Safari");
	});

	test("only a written address is opened before the agent", async () => {
		expect(messageNeedsCreatedContent("create a page at example.com/docs")).toBe(true);
		const plan = await planScreenShortcut({
			message: "create a page at example.com/docs",
			toolNames: ["open_url"],
			apiKey: "test",
			berry: true,
			fetchImpl: (async () => {
				throw new Error("Jev should not be called");
			}) as unknown as typeof fetch,
		});
		expect(plan?.continueWithAgent).toBe(true);
		expect(plan?.input.url).toContain("example.com");
		expect(extractMentionedSite("create a new cv template")).toBeUndefined();
	});

	test("a new page is not a website", () => {
		expect(extractSiteHint("write a new page")).toBeUndefined();
		expect(extractMentionedSite("write a new page")).toBeUndefined();
		const blocked = checkNavigate("https://new.com/", {
			task: "write a new page",
			seenHosts: new Set(),
		});
		expect(blocked.ok).toBe(false);
		expect(
			checkNavigate("https://example.com/", {
				task: "open example",
				seenHosts: new Set(["example.com"]),
			}).ok,
		).toBe(true);
	});

	test("stripBerryModeBanner keeps user words", () => {
		const wrapped = "[Berry autonomous mode] Act as…\n\ncan you open example";
		expect(stripBerryModeBanner(wrapped)).toBe("can you open example");
	});
});
