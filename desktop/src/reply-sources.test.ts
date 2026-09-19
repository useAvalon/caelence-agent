import { describe, expect, test } from "bun:test";
import { replySourcesForAssistant } from "./reply-sources.ts";
import type { StreamLine } from "./stream.ts";

function tool(
	partial: Partial<Extract<StreamLine, { type: "tool" }>> &
		Pick<Extract<StreamLine, { type: "tool" }>, "key" | "name" | "label" | "status">,
): Extract<StreamLine, { type: "tool" }> {
	return {
		type: "tool",
		callId: partial.key,
		count: 1,
		preview: "",
		...partial,
	};
}

describe("reply sources", () => {
	test("collects edits and search hits from the current turn", () => {
		const lines: StreamLine[] = [
			{ key: "u-0", type: "user", text: "fix readme", userTurnIndex: 0 },
			tool({
				key: "t1",
				name: "grep",
				label: "Searching files",
				status: "ok",
				output: JSON.stringify({
					pattern: "harness",
					hits: [
						{ path: "README.md", line: 1, text: "harness" },
						{ path: "src/runtime.ts", line: 2, text: "harness" },
					],
				}),
			}),
			tool({
				key: "t2",
				name: "edit_file",
				label: "Editing README.md",
				status: "ok",
				preview: "README.md",
			}),
			{ key: "a-1", type: "assistant", text: "updated" },
		];
		expect(replySourcesForAssistant(lines, "a-1")).toEqual([
			{ kind: "edit", path: "README.md", label: "README.md" },
			{ kind: "search", path: "src/runtime.ts", label: "src/runtime.ts" },
		]);
	});

	test("ignores earlier turns and failed tools", () => {
		const lines: StreamLine[] = [
			{ key: "u-0", type: "user", text: "old", userTurnIndex: 0 },
			tool({
				key: "old",
				name: "write_file",
				label: "Writing leftover.ts",
				status: "ok",
				preview: "leftover.ts",
			}),
			{ key: "a-0", type: "assistant", text: "done" },
			{ key: "u-1", type: "user", text: "new", userTurnIndex: 1 },
			tool({
				key: "fail",
				name: "write_file",
				label: "Writing no.ts",
				status: "fail",
				preview: "no.ts",
			}),
			{ key: "a-1", type: "assistant", text: "could not" },
		];
		expect(replySourcesForAssistant(lines, "a-1")).toEqual([]);
	});
});
