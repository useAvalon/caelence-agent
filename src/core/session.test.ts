import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createFileSessionStore,
	estimateTokens,
	latestCompactionCover,
	liveContextTokens,
	normalizeSessionTitle,
	replaceUserTurn,
	sessionToProviderMessages,
	sessionTranscript,
	titleFromUserMessage,
} from "./session.ts";

describe("session store", () => {
	test("titles collapse whitespace", () => {
		expect(titleFromUserMessage("  hello   world  ")).toBe("hello world");
		expect(titleFromUserMessage("x".repeat(80)).endsWith("…")).toBe(true);
		expect(normalizeSessionTitle("   ")).toBe("");
		expect(normalizeSessionTitle("  billing  copy  ")).toBe("billing copy");
	});

	test("append-only file store", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-ses-"));
		try {
			const store = createFileSessionStore(cwd);
			let session = await store.create("system");
			expect(session.messages[0]?.kind).toBe("system");
			session = await store.append(session, { kind: "turn", role: "user", content: "hi" });
			session = await store.append(session, { kind: "turn", role: "assistant", content: "hello" });
			const loaded = await store.get(session.id);
			expect(loaded?.messages.length).toBe(3);
			const list = await store.list();
			expect(list[0]?.id).toBe(session.id);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("transcript keeps tool calls between turns", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-transcript-"));
		try {
			const store = createFileSessionStore(cwd);
			let session = await store.create("system");
			session = await store.append(session, { kind: "turn", role: "user", content: "list pages" });
			session = await store.append(session, {
				kind: "thought",
				text: "I should look this up.",
			});
			session = await store.append(session, {
				kind: "tool",
				name: "notion__notion_fetch",
				callId: "call-1",
				status: "ok",
				preview: '{"id":"abc"}',
			});
			session = await store.append(session, { kind: "turn", role: "assistant", content: "done" });
			expect(sessionTranscript(session).map((line) => line.kind)).toEqual([
				"user",
				"thought",
				"tool",
				"assistant",
			]);
			expect(sessionToProviderMessages(session).map((line) => line.role)).toEqual([
				"user",
				"assistant",
			]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("compaction inserts a non-overlapping checkpoint", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-cmp-"));
		try {
			const store = createFileSessionStore(cwd);
			let session = await store.create("system");
			session = await store.append(session, {
				kind: "turn",
				role: "user",
				content: "a".repeat(400),
			});
			session = await store.append(session, {
				kind: "turn",
				role: "assistant",
				content: "b".repeat(400),
			});
			expect(estimateTokens(session.messages)).toBeGreaterThan(10);
			session = await store.maybeCompact(session, 20, async () => "summary of earlier turns");
			const last = session.messages[session.messages.length - 1];
			expect(last?.kind).toBe("compaction_checkpoint");
			if (last?.kind === "compaction_checkpoint") {
				expect(last.coversFromSeq).toBe(0);
				expect(last.summary).toBe("summary of earlier turns");
			}
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("provider messages omit turns already covered by a checkpoint", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-cover-"));
		try {
			const store = createFileSessionStore(cwd);
			let session = await store.create("system");
			session = await store.append(session, { kind: "turn", role: "user", content: "old" });
			session = await store.append(session, {
				kind: "turn",
				role: "assistant",
				content: "old reply",
			});
			session = await store.maybeCompact(session, 1, async () => "earlier work");
			session = await store.append(session, { kind: "turn", role: "user", content: "new" });
			session = await store.append(session, {
				kind: "turn",
				role: "assistant",
				content: "new reply",
			});
			expect(latestCompactionCover(session)).toBe(2);
			expect(sessionToProviderMessages(session)).toEqual([
				{ role: "user", content: "new" },
				{ role: "assistant", content: "new reply" },
			]);
			expect(liveContextTokens(session)).toBeLessThan(estimateTokens(session.messages));
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("auto-compact does not fire again until live context grows", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-live-"));
		try {
			const store = createFileSessionStore(cwd);
			let session = await store.create("system");
			session = await store.append(session, {
				kind: "turn",
				role: "user",
				content: "a".repeat(400),
			});
			session = await store.append(session, {
				kind: "turn",
				role: "assistant",
				content: "b".repeat(400),
			});
			session = await store.maybeCompact(session, 20, async () => "summary of earlier turns");
			const after = session.messages.length;
			session = await store.maybeCompact(session, 20, async () => {
				throw new Error("should not summarize again");
			});
			expect(session.messages.length).toBe(after);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("replaceUserTurn drops later turns and checkpoints", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-edit-"));
		try {
			const store = createFileSessionStore(cwd);
			let session = await store.create("system");
			session = await store.append(session, { kind: "turn", role: "user", content: "first" });
			session = await store.append(session, {
				kind: "turn",
				role: "assistant",
				content: "reply one",
			});
			session = await store.append(session, { kind: "turn", role: "user", content: "second" });
			session = await store.append(session, {
				kind: "turn",
				role: "assistant",
				content: "reply two",
			});
			session = await store.save(replaceUserTurn(session, 0, "first edited"));
			expect(sessionToProviderMessages(session)).toEqual([
				{ role: "user", content: "first edited" },
			]);
			expect(session.title).toBe("first edited");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("renames and deletes a chat", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-ses-edit-"));
		try {
			const store = createFileSessionStore(cwd);
			let session = await store.create("system");
			const updatedAt = session.updatedAt;
			session = await store.setTitle(session, "Billing copy");
			expect(session.title).toBe("Billing copy");
			expect(session.updatedAt).toBe(updatedAt);
			expect((await store.get(session.id))?.title).toBe("Billing copy");
			expect(await store.remove(session.id)).toBe(true);
			expect(await store.get(session.id)).toBeUndefined();
			expect(await store.list()).toEqual([]);
			expect(await store.remove(session.id)).toBe(false);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
