import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMemoryEnabled, writeMemoryPrefs } from "./prefs.ts";
import { formatMemoryList, formatRetrievedMemory } from "./prompt.ts";

describe("memory prefs", () => {
	test("is off unless the user or config turns it on", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-mem-pref-"));
		const env = { HARNESS_HOME: home };
		try {
			expect(isMemoryEnabled({ env })).toBe(false);
			expect(isMemoryEnabled({ configEnabled: true, env })).toBe(true);
			writeMemoryPrefs({ enabled: false }, env);
			expect(isMemoryEnabled({ configEnabled: true, env })).toBe(false);
			writeMemoryPrefs({ enabled: true }, env);
			expect(isMemoryEnabled({ env })).toBe(true);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("formats a retrieved block and a slash list", () => {
		expect(formatRetrievedMemory([])).toBe("");
		const retrieved = formatRetrievedMemory([
			{
				id: "mem_1",
				hash: "a",
				text: "Prefer bun",
				scope: "user",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		expect(retrieved).toContain("stored prefs");
		expect(retrieved).toContain("- Prefer bun");
		expect(formatMemoryList({ enabled: false, facts: [] })).toContain("Memory is off");
		expect(
			formatMemoryList({
				enabled: true,
				facts: [
					{
						id: "mem_1",
						hash: "a",
						text: "Prefer bun",
						scope: "user",
						createdAt: "2026-01-01T00:00:00.000Z",
					},
				],
			}),
		).toContain("1  user    Prefer bun");
	});
});
