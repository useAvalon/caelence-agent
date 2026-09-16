import { describe, expect, test } from "bun:test";
import { startOAuthLoopback } from "./loopback.ts";

describe("oauth loopback", () => {
	test("serves the callback page and resolves the waiter", async () => {
		const loopback = startOAuthLoopback({ timeoutMs: 2_000 });
		try {
			const pending = loopback.waitForCallback("abc");
			const res = await fetch(`${loopback.redirectUri}?state=abc&code=tok`);
			expect(res.ok).toBe(true);
			expect(await res.text()).toContain("Connected");
			expect(await pending).toEqual({ code: "tok", error: undefined });
		} finally {
			loopback.stop();
		}
	});
});
