import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MainModelProvider } from "../core/events.ts";
import { createMemorySessionStore } from "../core/session.ts";
import { extractMemories, parseExtractedFacts, turnMemorySource } from "./extract.ts";
import { listFacts } from "./store.ts";

describe("memory extract", () => {
	test("parses a JSON array and ignores chatter", () => {
		expect(
			parseExtractedFacts(
				'Here you go:\n[{"text":"Prefer bun","scope":"user"},{"text":"Bridge is loopback","scope":"project"}]\n',
			),
		).toEqual([
			{ text: "Prefer bun", scope: "user" },
			{ text: "Bridge is loopback", scope: "project" },
		]);
		expect(parseExtractedFacts("nothing durable")).toEqual([]);
		expect(parseExtractedFacts("[]")).toEqual([]);
	});

	test("builds a source from the last user, assistant, and tools", async () => {
		const store = createMemorySessionStore();
		let session = await store.create("sys");
		session = await store.append(session, { kind: "turn", role: "user", content: "use bun" });
		session = await store.append(session, {
			kind: "tool",
			name: "read_file",
			callId: "c1",
			status: "ok",
			preview: "package.json",
		});
		session = await store.append(session, {
			kind: "turn",
			role: "assistant",
			content: "I will keep using bun.",
		});
		const source = turnMemorySource(session);
		expect(source).toContain("use bun");
		expect(source).toContain("I will keep using bun.");
		expect(source).toContain("read_file: package.json");
	});

	test("stores extracted facts from the provider", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-mem-ex-"));
		const home = await mkdtemp(join(tmpdir(), "harness-mem-ex-home-"));
		const env = { HARNESS_HOME: home };
		const provider: MainModelProvider = {
			kind: "fake",
			modelId: "fake",
			async *stream() {
				yield {
					type: "text_delta",
					text: '[{"text":"Prefer bun over npm for installs","scope":"user"}]',
				};
				yield { type: "done" };
			},
		};
		try {
			const store = createMemorySessionStore();
			let session = await store.create("sys");
			session = await store.append(session, {
				kind: "turn",
				role: "user",
				content: "always use bun",
			});
			session = await store.append(session, {
				kind: "turn",
				role: "assistant",
				content: "I will use bun.",
			});
			expect(await extractMemories({ cwd, session, provider, env })).toBe(1);
			expect(listFacts(cwd, env)[0]?.text).toContain("Prefer bun");
		} finally {
			await rm(cwd, { recursive: true, force: true });
			await rm(home, { recursive: true, force: true });
		}
	});
});
