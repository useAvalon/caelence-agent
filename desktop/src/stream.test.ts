import { describe, expect, test } from "bun:test";
import {
	applyEvent,
	linesFromTranscript,
	type StreamLine,
	truncateAfterUserTurn,
} from "./stream.ts";

describe("applyEvent", () => {
	test("does not reprint the conversation title from session_meta", () => {
		const start: StreamLine[] = [
			{ key: "u-0", type: "user", text: "show me the latest cv", userTurnIndex: 0 },
		];
		const next = applyEvent(start, {
			kind: "session_meta",
			sessionId: "s1",
			title: "show me the latest cv",
		});
		expect(next).toEqual(start);
	});

	test("truncateAfterUserTurn keeps the edited user line and drops what followed", () => {
		const lines: StreamLine[] = [
			{ key: "u-0", type: "user", text: "one", userTurnIndex: 0 },
			{ key: "a-1", type: "assistant", text: "reply" },
			{ key: "u-2", type: "user", text: "two", userTurnIndex: 1 },
		];
		expect(truncateAfterUserTurn(lines, 0, "one edited")).toEqual([
			{ key: "u-0", type: "user", text: "one edited", userTurnIndex: 0 },
		]);
	});

	test("linesFromTranscript keeps tool calls between turns", () => {
		const lines = linesFromTranscript([
			{ kind: "user", text: "list pages" },
			{
				kind: "tool",
				name: "notion__notion_fetch",
				callId: "call-1",
				status: "ok",
				preview: '{"id":"abc"}',
			},
			{ kind: "assistant", text: "done" },
		]);
		expect(lines.map((line) => line.type)).toEqual(["user", "tool", "assistant"]);
		expect(lines[1]).toMatchObject({
			type: "tool",
			name: "notion__notion_fetch",
			status: "ok",
			label: "Notion fetch",
			count: 1,
		});
	});

	test("coalesces back-to-back identical tool starts", () => {
		const first = applyEvent([], {
			kind: "tool_call_start",
			toolName: "notion__notion_fetch",
			callId: "a",
			input: { id: "1" },
		});
		const second = applyEvent(first, {
			kind: "tool_call_start",
			toolName: "notion__notion_fetch",
			callId: "b",
			input: { id: "2" },
		});
		expect(second).toHaveLength(1);
		expect(second[0]).toMatchObject({ type: "tool", label: "Notion fetch", count: 2, callId: "b" });
	});

	test("appends reasoning deltas onto a thought line", () => {
		const first = applyEvent([], { kind: "reasoning_delta", text: "look up " });
		const second = applyEvent(first, { kind: "reasoning_delta", text: "the page" });
		expect(second).toEqual([{ key: "th-0", type: "thought", text: "look up the page" }]);
	});

	test("linesFromTranscript keeps thoughts between turns", () => {
		const lines = linesFromTranscript([
			{ kind: "user", text: "list pages" },
			{ kind: "thought", text: "I should search Notion." },
			{
				kind: "tool",
				name: "notion__notion_fetch",
				callId: "call-1",
				status: "ok",
				preview: '{"id":"abc"}',
			},
			{ kind: "assistant", text: "done" },
		]);
		expect(lines.map((line) => line.type)).toEqual(["user", "thought", "tool", "assistant"]);
	});
});
