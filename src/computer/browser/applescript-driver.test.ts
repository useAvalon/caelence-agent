import { describe, expect, test } from "bun:test";
import { hostOfUrl, urlListHasHost } from "./applescript-driver.ts";

describe("tab reuse matching", () => {
	test("normalizes www and scheme", () => {
		expect(hostOfUrl("https://www.linkedin.com/feed/")).toBe("linkedin.com");
		expect(hostOfUrl("linkedin.com")).toBe("linkedin.com");
	});

	test("finds an existing host in a tab list", () => {
		const listed = [
			"https://news.ycombinator.com/",
			"https://www.linkedin.com/feed/",
			"https://mail.google.com/",
		].join("\n");
		expect(urlListHasHost(listed, "linkedin.com")).toBe(true);
		expect(urlListHasHost(listed, "https://www.linkedin.com/feed/?shareActive=true")).toBe(true);
		expect(urlListHasHost(listed, "canva.com")).toBe(false);
	});

	test("reads comma-separated AppleScript lists", () => {
		expect(
			urlListHasHost(
				"https://news.ycombinator.com/, https://www.linkedin.com/feed/",
				"linkedin.com",
			),
		).toBe(true);
	});
});
