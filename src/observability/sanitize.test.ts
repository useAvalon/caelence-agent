import { describe, expect, test } from "bun:test";
import { sanitize } from "./sanitize.ts";

describe("sanitize", () => {
	test("redacts secret keys and bearer tokens", () => {
		const out = sanitize({
			authorization: "Bearer abc",
			apiKey: "sk-secret",
			nested: { password: "hunter2", note: "ok" },
			header: "Bearer supersecret",
			DATABASE_URL: "postgres://user:pass@host/db",
		}) as Record<string, unknown>;
		expect(out.authorization).toBe("[redacted]");
		expect(out.apiKey).toBe("[redacted]");
		expect((out.nested as Record<string, unknown>).password).toBe("[redacted]");
		expect((out.nested as Record<string, unknown>).note).toBe("ok");
		expect(out.header).toBe("[redacted]");
		expect(out.DATABASE_URL).toBe("[redacted]");
	});

	test("truncates long strings", () => {
		const out = sanitize("x".repeat(9000)) as string;
		expect(out.endsWith("…")).toBe(true);
		expect(out.length).toBeLessThan(9005);
	});
});
