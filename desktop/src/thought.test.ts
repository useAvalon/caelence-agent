import { describe, expect, test } from "bun:test";
import {
	groupTranscriptLines,
	liveStatusPhrases,
	type ToolLine,
	thoughtSummary,
	thoughtTools,
	warmupHeadline,
} from "./thought.ts";

function tool(partial: Partial<ToolLine> & Pick<ToolLine, "key" | "label" | "status">): ToolLine {
	return {
		type: "tool",
		name: "read_file",
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
			tool({ key: "t1", label: "Reading src/a.ts", status: "ok", name: "read_file" }),
			tool({ key: "t2", label: "Searching files", status: "ok", name: "grep" }),
			{ key: "a-1", type: "assistant", text: "done" },
		]);
		expect(blocks.map((block) => block.type)).toEqual(["line", "thought", "line"]);
		expect(blocks[1]?.type === "thought" && thoughtTools(blocks[1].entries)).toHaveLength(2);
		expect(
			thoughtSummary(blocks[1]?.type === "thought" ? thoughtTools(blocks[1].entries) : [], false)
				.headline,
		).toBe("Explored 1 file, 1 search");
	});

	test("keeps integration tools as their own window", () => {
		const blocks = groupTranscriptLines([
			{ key: "u-0", type: "user", text: "pages", userTurnIndex: 0 },
			tool({
				key: "t1",
				label: "Notion fetch",
				status: "ok",
				name: "notion__notion_fetch",
				output: '{"title":"Notes"}',
			}),
			{ key: "a-1", type: "assistant", text: "here" },
		]);
		expect(blocks.map((block) => block.type)).toEqual(["line", "line", "line"]);
		expect(blocks[1]).toMatchObject({
			type: "line",
			line: { type: "tool", name: "notion__notion_fetch" },
		});
	});

	test("stays live between tool calls until the assistant replies", () => {
		const blocks = groupTranscriptLines([
			{ key: "u-0", type: "user", text: "cv", userTurnIndex: 0 },
			tool({ key: "t1", label: "Reading src/a.ts", status: "ok", name: "read_file" }),
			tool({ key: "t2", label: "Searching files", status: "ok", name: "grep" }),
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
		expect(warmupHeadline(0)).toBe("Thinking");
		expect(warmupHeadline(1)).toBe("Looking this over");
		expect(warmupHeadline(2)).toBe("Working it out");
		expect(warmupHeadline(3)).toBe("Thinking");
		expect(thoughtSummary([], true, { warmup: true, seed: 1 }).headline).toBe("Thinking");
		expect(liveStatusPhrases([], true)).toEqual([
			"Thinking",
			"Looking this over",
			"Working it out",
		]);
	});

	test("live phrases follow the in-flight tool then thinking", () => {
		const tools = [
			tool({ key: "t1", label: "Searching files", status: "ok", name: "grep" }),
			tool({ key: "t2", label: "Reading src/a.ts", status: "running", name: "read_file" }),
		];
		expect(liveStatusPhrases(tools)[0]).toBe("Reading src/a.ts");
		expect(liveStatusPhrases(tools)).toContain("Thinking");
		expect(thoughtSummary(tools, true)).toEqual({ headline: "Reading src/a.ts" });
	});

	test("skill reads use a pipeline headline instead of thinking", () => {
		const tools = [
			tool({
				key: "t1",
				label: "Reading Copywriting",
				status: "ok",
				name: "read_skill",
				preview: '{"name":"copywriting"}',
			}),
			tool({
				key: "t2",
				label: "Reading RMBC",
				status: "running",
				name: "read_skill",
				preview: '{"name":"copy-rmbc"}',
			}),
		];
		expect(liveStatusPhrases(tools)[0]).toBe("Running RMBC");
		expect(liveStatusPhrases(tools)).toContain("Running Copywriting");
		expect(liveStatusPhrases(tools)).not.toContain("Thinking");
		expect(thoughtSummary(tools, false).headline).toBe("Ran Copywriting");
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
