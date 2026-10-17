import { describe, expect, test } from "bun:test";
import {
	documentTitle,
	extractComposeBody,
	extractQuotedCopy,
	fieldHasNeedle,
	newDocumentRef,
	pageIsBlank,
	pageTopic,
	shouldGeneratePost,
	stripDraftWrapper,
	subjectFitsPage,
	tabReadingText,
	textboxRefFromSnapshot,
	wantsNewDocument,
	withoutAsk,
} from "./compose.ts";

describe("compose helpers", () => {
	test("pulls headlines out of a tab snapshot", () => {
		const snap = [
			"URL: https://www.cnn.com/",
			"TITLE: CNN",
			'[1] link "Home"',
			'[2] button "Sign in"',
			'[3] link "Markets jumped after the Fed held interest rates steady overnight"',
			'[4] link "Storms knock out power for thousands across the Midwest this morning"',
		].join("\n");
		const reading = tabReadingText(snap);
		expect(reading).toContain("Markets jumped");
		expect(reading).toContain("Storms knock out");
		expect(reading).not.toContain("Sign in");
		expect(reading).not.toContain("CNN");
	});

	test("drops the user ask and generic news titles", () => {
		const ask = "analyze top 10 news and post on x";
		const snap = [
			"TITLE: Breaking News, Latest News",
			ask,
			'[3] link "Markets jumped after the Fed held interest rates steady overnight"',
		].join("\n");
		const reading = withoutAsk(ask, tabReadingText(snap));
		expect(reading).toContain("Markets jumped");
		expect(reading).not.toContain("Breaking News");
		expect(reading).not.toContain("analyze top 10");
	});

	test("uses quoted copy as the post body", () => {
		expect(extractQuotedCopy('Write a LinkedIn post that says "Hello from Berry"')).toBe(
			"Hello from Berry",
		);
	});

	test("strips the site and the draft preamble", () => {
		expect(extractComposeBody("Draft a post on LinkedIn about AR glasses")).toContain("AR");
	});

	test("strips wrapping quotes from a model draft", () => {
		expect(stripDraftWrapper('"Excited to share some new updates soon!"')).toBe(
			"Excited to share some new updates soon!",
		);
	});

	test("writes a generated post instead of echoing the ask", () => {
		const ask = "Open LinkedIn and some content about AI";
		expect(shouldGeneratePost(ask, undefined, extractComposeBody(ask, "linkedin.com"))).toBe(true);
	});

	test("does not treat page text as proof the field was typed", () => {
		const snap = ['n1 textbox "Search"', 'n2 button "Start a post"', 'n3 textbox ""'].join("\n");
		expect(fieldHasNeedle(snap, "WebMCP lets a site")).toBe(false);
		expect(
			fieldHasNeedle(
				`${snap}\nn4 textbox "WebMCP lets a site register tools"`,
				"WebMCP lets a site",
			),
		).toBe(true);
	});

	test("treats a blank Notion page as somewhere to type", () => {
		expect(pageIsBlank("New page")).toBe(true);
		expect(pageIsBlank("New page | Notion")).toBe(true);
		expect(pageIsBlank("Untitled")).toBe(true);
		expect(pageIsBlank("How to grow | Notion")).toBe(false);
	});

	test("finds the post textbox and skips Arc search", () => {
		const snap = [
			"Frontmost app: Arc",
			'n1 textbox "Search or enter a URL"',
			'n2 button "Home"',
			'n3 textbox "Share your thoughts"',
		].join("\n");
		expect(textboxRefFromSnapshot(snap)).toBe("n3");
	});

	test("does not type into a chat or IDE composer", () => {
		const snap = [
			"Frontmost app: Arc",
			'n1 textbox "Search or enter a URL"',
			'n2 textbox "Reply to Claude"',
		].join("\n");
		expect(textboxRefFromSnapshot(snap)).toBeUndefined();
	});

	test("finds LinkedIn talk-about editor", () => {
		const snap = [
			"Frontmost app: Arc",
			'n1 textbox "Search or enter a URL"',
			'n2 textbox "What do you want to talk about?"',
		].join("\n");
		expect(textboxRefFromSnapshot(snap)).toBe("n2");
	});

	test("asks before writing a different subject into the open page", () => {
		const snap = ["TITLE Apples", 'n1 textbox "How to grow apples in a small garden"'].join("\n");
		expect(pageTopic(snap)).toContain("apples");
		expect(subjectFitsPage("go to the site and write about ai", pageTopic(snap))).toBe(false);
		expect(subjectFitsPage("write more about apples", pageTopic(snap))).toBe(true);
		expect(subjectFitsPage("write about ai", "")).toBe(true);
		expect(subjectFitsPage("write about ai", documentTitle("Apples | Notion"))).toBe(false);
		expect(documentTitle("Apples | Notion")).toBe("Apples");
		expect(newDocumentRef('Frontmost app: Chrome\nn4 button "New page"')).toBe("n4");
		expect(wantsNewDocument("go to the site and create a page about crux")).toBe(true);
		expect(wantsNewDocument("add a sentence to this page")).toBe(false);
	});

	test("does not treat the Chrome address bar as the composer", () => {
		const snap = [
			"Frontmost app: Google Chrome",
			'n1 textbox "Address and search bar"',
			'n2 textbox "https://www.linkedin.com/feed/?shareActive=true"',
			'n3 textbox ""',
		].join("\n");
		expect(textboxRefFromSnapshot(snap)).toBeUndefined();
	});
});
