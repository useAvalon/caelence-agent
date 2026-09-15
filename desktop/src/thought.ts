import type { StreamLine } from "./stream";
import { eventCountSuffix } from "./tool-label";

export type ToolLine = Extract<StreamLine, { type: "tool" }>;

export type FoldEntry = { type: "note"; text: string } | { type: "tool"; tool: ToolLine };

export type TranscriptBlock =
	| { type: "line"; line: StreamLine }
	| { type: "thought"; entries: FoldEntry[]; live: boolean };

function isFoldLine(line: StreamLine): line is ToolLine | Extract<StreamLine, { type: "thought" }> {
	return line.type === "tool" || line.type === "thought";
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
const WARMUP_HEADLINES = ["Getting ready", "Loading", "Warming up"] as const;

function isWriteTool(tool: ToolLine): boolean {
	return WRITE_LABEL.test(tool.label) || WRITE_NAME.test(tool.name);
}

export function warmupHeadline(seed: number): string {
	return WARMUP_HEADLINES[Math.abs(seed) % WARMUP_HEADLINES.length] ?? "Getting ready";
}

export function thoughtSummary(
	tools: ToolLine[],
	live: boolean,
	options?: { warmup?: boolean; seed?: number },
): { headline: string; activity?: string } {
	if (live && options?.warmup) {
		return { headline: warmupHeadline(options.seed ?? 0) };
	}
	if (live) {
		const running = [...tools].reverse().find((tool) => tool.status === "running");
		return {
			headline: "Thinking",
			...(running ? { activity: `${running.label}${eventCountSuffix(running.count)}` } : {}),
		};
	}
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
