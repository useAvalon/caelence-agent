import { describe, expect, test } from "bun:test";
import { planScreenWork } from "./plan.ts";

describe("screen work plan", () => {
	test("pointing at the open tab with no destination is a reply", () => {
		expect(planScreenWork("analyze top 10 news on current tab")).toEqual({
			source: "front",
			put: "reply",
		});
	});

	test("a named site is where the result goes", () => {
		const plan = planScreenWork("summarize top news on current tab and post on x");
		expect(plan.source).toBe("front");
		expect(plan.put).toBe("site");
		expect(plan.dest).toContain("x.com");
	});

	test("a named destination reads the front tab without extra pointing words", () => {
		const plan = planScreenWork("analyze top 10 news and post on x");
		expect(plan.source).toBe("front");
		expect(plan.put).toBe("site");
		expect(plan.dest).toContain("x.com");
	});

	test("a local app is not a website", () => {
		const plan = planScreenWork("summarize this tab and write it in notes app");
		expect(plan.source).toBe("front");
		expect(plan.put).toBe("app");
		expect(plan.dest).toBe("Notes");
		expect(planScreenWork("no my local mac notes app").put).toBe("app");
		expect(planScreenWork("no my local mac notes app").dest).toBe("Notes");
	});

	test("a named connection is where the result goes", () => {
		const plan = planScreenWork("use the current tab and write a new page on notion about it");
		expect(plan.source).toBe("front");
		expect(plan.put === "catalog" || plan.put === "site").toBe(true);
		expect(plan.dest).toContain("notion");
	});
});
