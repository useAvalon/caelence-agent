import { describe, expect, test } from "bun:test";
import {
	groupTranscriptLines,
	type ToolLine,
	thoughtSummary,
	thoughtTools,
	warmupHeadline,
} from "./thought.ts";

function tool(partial: Partial<ToolLine> & Pick<ToolLine, "key" | "label" | "status">): ToolLine {
	return {
		type: "tool",
		name: "notion__notion_fetch",
		callId: partial.key,
		count: 1,
		preview: "",
		...partial,
	};
}

describe("thought fold", () => {
	test("hides consecutive tool rows behind one thought block", () => {
		const blocks = groupTranscriptLines([
			{ key: "u-0", type: "user", text: "cv", userTurnIndex: 0 },
			tool({ key: "t1", label: "Notion fetch", status: "ok" }),
			tool({ key: "t2", label: "Notion search", status: "ok", name: "notion__notion_search" }),
			{ key: "a-1", type: "assistant", text: "done" },
		]);
		expect(blocks.map((block) => block.type)).toEqual(["line", "thought", "line"]);
		expect(blocks[1]?.type === "thought" && thoughtTools(blocks[1].entries)).toHaveLength(2);
		expect(
			thoughtSummary(blocks[1]?.type === "thought" ? thoughtTools(blocks[1].entries) : [], false)
				.headline,
		).toBe("Explored 1 search");
	});

	test("stays live between tool calls until the assistant replies", () => {
		const blocks = groupTranscriptLines([
			{ key: "u-0", type: "user", text: "cv", userTurnIndex: 0 },
			tool({ key: "t1", label: "Notion fetch", status: "ok" }),
			tool({ key: "t2", label: "Notion search", status: "ok" }),
		]);
		expect(blocks[1]?.type === "thought" && blocks[1].live).toBe(true);
		const settled = groupTranscriptLines([
			{ key: "u-0", type: "user", text: "cv", userTurnIndex: 0 },
			tool({ key: "t1", label: "Notion fetch", status: "ok" }),
			{ key: "a-1", type: "assistant", text: "done" },
		]);
		expect(settled[1]?.type === "thought" && settled[1].live).toBe(false);
	});

	test("warmup headlines rotate without inventing a duration", () => {
		expect(warmupHeadline(0)).toBe("Getting ready");
		expect(warmupHeadline(1)).toBe("Loading");
		expect(warmupHeadline(2)).toBe("Warming up");
		expect(warmupHeadline(3)).toBe("Getting ready");
		expect(thoughtSummary([], true, { warmup: true, seed: 1 }).headline).toBe("Loading");
	});

	test("live thought keeps Thinking and names the in-flight tool", () => {
		const tools = [
			tool({ key: "t1", label: "Notion search", status: "ok", name: "notion__notion_search" }),
			tool({ key: "t2", label: "Notion fetch", status: "running" }),
		];
		expect(thoughtSummary(tools, true)).toEqual({
			headline: "Thinking",
			activity: "Notion fetch",
		});
	});

	test("done headlines follow thought, explored, or worked", () => {
		expect(thoughtSummary([], false).headline).toBe("Thought");
		expect(
			thoughtSummary([tool({ key: "t1", label: "Notion fetch", status: "ok" })], false).headline,
		).toBe("Explored");
		expect(
			thoughtSummary(
				[tool({ key: "w1", label: "Writing src/a.ts", status: "ok", name: "write_file" })],
				false,
			).headline,
		).toBe("Worked");
	});

	test("folds reasoning notes with the tools", () => {
		const blocks = groupTranscriptLines([
			{ key: "u-0", type: "user", text: "cv", userTurnIndex: 0 },
			{ key: "th-1", type: "thought", text: "I should look this up." },
			tool({ key: "t1", label: "Notion fetch", status: "ok" }),
			{ key: "a-2", type: "assistant", text: "done" },
		]);
		expect(blocks[1]?.type).toBe("thought");
		if (blocks[1]?.type !== "thought") return;
		expect(blocks[1].entries[0]).toEqual({ type: "note", text: "I should look this up." });
		expect(blocks[1].entries[1]?.type).toBe("tool");
	});
});
