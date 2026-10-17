import { describe, expect, test } from "bun:test";
import {
	asksAboutCurrentScreen,
	extractSiteHint,
	looksLikeRefusal,
	readSite,
	saveTargetName,
	screenQuestionOnly,
} from "../decisions/screen-shortcut.ts";
import { routeComputerTask } from "./router.ts";

describe("computer router", () => {
	test("opens Notes without entering the loop", () => {
		const route = routeComputerTask("Open Notes");
		expect(route).toEqual({
			kind: "direct",
			tool: "open_app",
			arg: "Notes",
			reply: "Opened Notes.",
		});
	});

	test("analyzing news on the current tab is a look, not a post to type", () => {
		const ask = "analyze top 10 news on current tab";
		expect(asksAboutCurrentScreen(ask)).toBe(true);
		expect(screenQuestionOnly(ask)).toBe(true);
		expect(extractSiteHint(ask)).toBeUndefined();
		expect(routeComputerTask(ask).kind).toBe("simple");
		expect(
			extractSiteHint(
				"summarize top news on current tab and post on x\nanalyze top 10 news on current tab",
			),
		).toBeUndefined();
	});

	test("stays with the app already on screen", () => {
		const ask = "analyze the stock price on my current open tradingview window app";
		expect(asksAboutCurrentScreen(ask)).toBe(true);
		expect(extractSiteHint(ask)).toBeUndefined();
		expect(screenQuestionOnly(ask)).toBe(true);
		expect(routeComputerTask(ask).kind).toBe("simple");
	});

	test("opens a named site without entering the loop", () => {
		const route = routeComputerTask("Open https://example.com");
		expect(route.kind).toBe("direct");
		if (route.kind === "direct") expect(route.tool).toBe("open_url");
	});

	test("reads x before writing the note in notion", () => {
		const ask = "go to x.com and analyze the 20 first posts on x and write about it in notion";
		expect(readSite(ask)).toContain("x.com");
		expect(saveTargetName(ask)).toBe("notion");
		expect(
			looksLikeRefusal(
				"I cannot access your X feed. Please copy the content and paste directly into this Notion page.",
			),
		).toBe(true);
	});

	test("goes to linkedin even when the current tab is mentioned", () => {
		const ask = "go to linkedin and write a post about current tab";
		expect(screenQuestionOnly(ask)).toBe(false);
		expect(extractSiteHint(ask)).toContain("linkedin.com");
		expect(routeComputerTask(ask).kind).toBe("complex");
	});

	test("writes a notion page about the current tab instead of only describing it", () => {
		const ask = "use the current tab and write a new page on notion about it";
		expect(asksAboutCurrentScreen(ask)).toBe(true);
		expect(extractSiteHint(ask)).toContain("notion.com");
		expect(routeComputerTask(ask).kind).toBe("complex");
	});

	test("a draft with no named place stays on chat", () => {
		expect(routeComputerTask("Draft a post about shipping").kind).toBe("chat");
	});

	test("write it in the notes app stays off the web", () => {
		const ask = "summarize this tab and write it in notes app";
		expect(extractSiteHint(ask)).toBeUndefined();
		expect(routeComputerTask(ask).kind).toBe("complex");
		expect(extractSiteHint("no my local mac notes app")).toBeUndefined();
	});

	test("summarize this tab and post on x is a post, not a screen question", () => {
		const ask = "summarize top news on current tab and post on x";
		expect(asksAboutCurrentScreen(ask)).toBe(true);
		expect(screenQuestionOnly(ask)).toBe(false);
		expect(extractSiteHint(ask)).toContain("x.com");
		expect(routeComputerTask(ask).kind).toBe("complex");
		expect(routeComputerTask("analyze top 10 news and post on x").kind).toBe("complex");
	});

	test("leaves research questions on the chat path", () => {
		expect(routeComputerTask("What is a binary tree?").kind).toBe("chat");
	});

	test("reads the live page when asked about a listing already on screen", () => {
		const ask = "what does this job post say";
		expect(asksAboutCurrentScreen(ask)).toBe(true);
		expect(screenQuestionOnly(ask)).toBe(true);
		expect(routeComputerTask(ask).kind).toBe("simple");
		expect(screenQuestionOnly("summarize this page")).toBe(true);
		expect(screenQuestionOnly("write a post about this page")).toBe(true);
		expect(screenQuestionOnly("write a post about this page on x")).toBe(false);
	});
});
