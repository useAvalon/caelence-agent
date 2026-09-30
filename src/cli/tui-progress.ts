import { clipLabel } from "./tui-layout.ts";
import type { TurnToolLine } from "./tui-stream.ts";

export const WARMUP_PHRASES = ["Thinking", "Looking this over", "Working it out"] as const;

const TICK_FRAMES = ["", ".", "..", "..."] as const;

export function warmupHeadline(seed: number): string {
	return WARMUP_PHRASES[Math.abs(seed) % WARMUP_PHRASES.length] ?? "Thinking";
}

const TOOL_ACTIVITY_RULES: ReadonlyArray<{
	match: RegExp;
	verb: string;
	previewWidth: number;
}> = [
	{ match: /read_file|read/i, verb: "Reading", previewWidth: 48 },
	{ match: /grep|glob|search/i, verb: "Searching", previewWidth: 40 },
	{ match: /write_file|edit_file|str_replace|apply_patch/i, verb: "Editing", previewWidth: 48 },
	{ match: /exec|shell|bash/i, verb: "Running", previewWidth: 40 },
	{ match: /git_/i, verb: "Git", previewWidth: 40 },
];

function labelWithPreview(verb: string, preview: string, width: number): string {
	return preview ? `${verb} ${clipLabel(preview, width)}` : verb;
}

function toolActivityLabel(tool: TurnToolLine): string {
	const preview = tool.preview.trim();
	const rule = TOOL_ACTIVITY_RULES.find((entry) => entry.match.test(tool.name));
	if (rule) return labelWithPreview(rule.verb, preview, rule.previewWidth);
	return preview ? `${tool.name} ${clipLabel(preview, 40)}` : tool.name;
}

export function turnProgressLabel(input: {
	tools: readonly TurnToolLine[];
	assistantStarted: boolean;
	tick: number;
	warmupSeed: number;
}): string {
	if (input.assistantStarted) {
		const frame = TICK_FRAMES[input.tick % TICK_FRAMES.length] ?? "";
		return `Writing${frame}`;
	}
	const running = [...input.tools].reverse().find((tool) => tool.status === "running");
	if (running) {
		const frame = TICK_FRAMES[input.tick % TICK_FRAMES.length] ?? "";
		return `${toolActivityLabel(running)}${frame}`;
	}
	if (input.tools.length > 0) {
		return `${warmupHeadline(input.warmupSeed)}…`;
	}
	const frame = TICK_FRAMES[input.tick % TICK_FRAMES.length] ?? "";
	return `${warmupHeadline(input.warmupSeed)}${frame}`;
}
