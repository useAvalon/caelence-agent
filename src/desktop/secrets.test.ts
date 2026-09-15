import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyStoredOpenRouterKey,
	maskSecret,
	readOpenRouterKey,
	writeOpenRouterKey,
} from "./secrets.ts";

describe("openrouter key store", () => {
	test("masks all but the last four characters", () => {
		expect(maskSecret("")).toBe("");
		expect(maskSecret("abcd")).toBe("••••");
		expect(maskSecret("sk-or-v1-hello")).toBe("••••ello");
	});

	test("writes, reads, and clears a key file", () => {
		const home = mkdtempSync(join(tmpdir(), "harness-secrets-"));
		const env = { HARNESS_HOME: home };
		expect(readOpenRouterKey(env)).toBe("");
		writeOpenRouterKey("sk-test-key", env);
		expect(readOpenRouterKey(env)).toBe("sk-test-key");
		writeOpenRouterKey("", env);
		expect(readOpenRouterKey(env)).toBe("");
	});

	test("env wins over the stored file", () => {
		const home = mkdtempSync(join(tmpdir(), "harness-secrets-"));
		const env: Record<string, string | undefined> = { HARNESS_HOME: home };
		writeOpenRouterKey("stored-key", env);
		env.OPENROUTER_API_KEY = "env-key";
		expect(applyStoredOpenRouterKey(env)).toBe("env-key");
	});

	test("loads the file when env is empty", () => {
		const home = mkdtempSync(join(tmpdir(), "harness-secrets-"));
		const env: Record<string, string | undefined> = { HARNESS_HOME: home };
		writeOpenRouterKey("stored-key", env);
		expect(applyStoredOpenRouterKey(env)).toBe("stored-key");
		expect(env.OPENROUTER_API_KEY).toBe("stored-key");
	});
});
