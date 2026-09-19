import { pipelineProgress } from "./pipeline";
import { isPlatformTool } from "./platform";
import type { StreamLine } from "./stream";
import { eventCountSuffix } from "./tool-label";

export type ToolLine = Extract<StreamLine, { type: "tool" }>;

export type FoldEntry = { type: "note"; text: string } | { type: "tool"; tool: ToolLine };

export type TranscriptBlock =
	| { type: "line"; line: StreamLine }
	| { type: "thought"; entries: FoldEntry[]; live: boolean };

function isFoldLine(line: StreamLine): line is ToolLine | Extract<StreamLine, { type: "thought" }> {
	if (line.type === "thought") return true;
	return line.type === "tool" && !isPlatformTool(line.name);
}

export function thoughtTools(entries: FoldEntry[]): ToolLine[] {
	return entries.flatMap((entry) => (entry.type === "tool" ? [entry.tool] : []));
}

export function groupTranscriptLines(lines: StreamLine[]): TranscriptBlock[] {
	const out: TranscriptBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (!line || !isFoldLine(line)) {
			if (line) out.push({ type: "line", line });
			i += 1;
			continue;
		}
		const entries: FoldEntry[] = [];
		while (i < lines.length) {
			const next = lines[i];
			if (!next || !isFoldLine(next)) break;
			if (next.type === "tool") entries.push({ type: "tool", tool: next });
			else {
				const last = entries.at(-1);
				if (last?.type === "note") last.text += next.text;
				else entries.push({ type: "note", text: next.text });
			}
			i += 1;
		}
		out.push({ type: "thought", entries, live: i >= lines.length });
	}
	return out;
}

const WRITE_LABEL = /^(?:Writing|Editing)\b/u;
const WRITE_NAME = /write_file|edit_file|str_replace|apply_patch|shell|bash|git_commit/i;
export const WARMUP_PHRASES = ["Thinking", "Looking this over", "Working it out"] as const;

function isWriteTool(tool: ToolLine): boolean {
	return WRITE_LABEL.test(tool.label) || WRITE_NAME.test(tool.name);
}

function pushPhrase(out: string[], value: string): void {
	const text = value.trim();
	if (!text) return;
	if (out.some((item) => item.toLowerCase() === text.toLowerCase())) return;
	out.push(text);
}

export function warmupHeadline(seed: number): string {
	return WARMUP_PHRASES[Math.abs(seed) % WARMUP_PHRASES.length] ?? "Thinking";
}

export function liveStatusPhrases(tools: ToolLine[], warmup = false): string[] {
	if (warmup || tools.length === 0) return [...WARMUP_PHRASES];
	const pipe = pipelineProgress(tools);
	const out: string[] = [];
	if (pipe) {
		pushPhrase(out, pipe.title);
		pushPhrase(out, `Running ${pipe.family}`);
		return out;
	}
	const running = [...tools].reverse().find((tool) => tool.status === "running");
	const current = running ?? [...tools].reverse().find((tool) => tool.label.trim());
	if (current) {
		pushPhrase(out, `${current.label}${eventCountSuffix(current.count)}`);
		if (/^Reading\b/u.test(current.label) || current.name === "read_file")
			pushPhrase(out, "Reading");
		if (/search|grep|glob/i.test(current.name) || /^Searching\b/u.test(current.label)) {
			pushPhrase(out, "Searching");
		}
		if (isWriteTool(current)) pushPhrase(out, "Editing");
	}
	pushPhrase(out, "Thinking");
	pushPhrase(out, "Looking this over");
	return out;
}

export function thoughtSummary(
	tools: ToolLine[],
	live: boolean,
	options?: { warmup?: boolean; seed?: number },
): { headline: string; activity?: string } {
	if (live) {
		return { headline: liveStatusPhrases(tools, options?.warmup).at(0) ?? "Thinking" };
	}
	const pipe = pipelineProgress(tools);
	if (pipe && !tools.some(isWriteTool)) return { headline: `Ran ${pipe.family}` };
	if (tools.some(isWriteTool)) return { headline: "Worked" };
	if (tools.length === 0) return { headline: "Thought" };
	const files = new Set<string>();
	let searches = 0;
	for (const tool of tools) {
		const file = /^(?:Reading|Writing|Editing)\s+(\S+)/u.exec(tool.label);
		if (file?.[1]) files.add(file[1]);
		if (/search/i.test(tool.name) || /^Searching\b/u.test(tool.label)) searches += 1;
	}
	const parts: string[] = [];
	if (files.size > 0) parts.push(`${files.size} ${files.size === 1 ? "file" : "files"}`);
	if (searches > 0) parts.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
	return { headline: parts.length > 0 ? `Explored ${parts.join(", ")}` : "Explored" };
}
