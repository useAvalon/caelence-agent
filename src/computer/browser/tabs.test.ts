import { describe, expect, test } from "bun:test";
import { repeatDecision } from "./repeat.ts";
import { pathOf, reuseCandidate, tabToClose } from "./tabs.ts";

describe("browser tabs", () => {
	test("reuses a tab on the same host and ignores www", () => {
		const pages = [
			{ id: "a", url: "https://example.com/feed" },
			{ id: "b", url: "https://other.test/" },
		];
		expect(reuseCandidate(pages, "https://www.example.com/messages")?.id).toBe("a");
		expect(reuseCandidate(pages, "https://news.test/")?.id).toBeUndefined();
	});

	test("closes the oldest owned tab that is not active", () => {
		expect(tabToClose(["1", "2", "3"], "3")).toBeUndefined();
		expect(tabToClose(["1", "2", "3", "4"], "4")).toBe("1");
		expect(tabToClose(["1", "2", "3", "4"], "1")).toBe("2");
	});

	test("treats the same path as unchanged", () => {
		expect(pathOf("https://example.com/feed/")).toBe("/feed");
		expect(pathOf("https://example.com/feed")).toBe("/feed");
	});
});

describe("repeated actions", () => {
	test("skips the second time and asks after the larger model repeats", () => {
		const seen = new Map<string, number>();
		expect(repeatDecision(seen, "navigate:example.com")).toBe("ok");
		expect(repeatDecision(seen, "navigate:example.com")).toBe("skip");
		expect(repeatDecision(seen, "navigate:example.com")).toBe("escalate");
		expect(repeatDecision(seen, "navigate:example.com")).toBe("ask");
	});
});
