import type { StreamLine } from "./stream";

export type ReplySourceKind = "edit" | "read" | "search" | "web";

export interface ReplySource {
	kind: ReplySourceKind;
	path: string;
	label: string;
}

const LABEL_FILE = /^(?:Reading|Writing|Editing)\s+(\S+)/u;
const WRITE_TOOLS = new Set(["write_file", "edit_file"]);
const READ_TOOLS = new Set(["read_file"]);
const SEARCH_TOOLS = new Set(["grep", "glob"]);
const SOURCE_CAP = 12;

function looksLikePath(value: string): boolean {
	if (!value || value.length > 240) return false;
	if (value.startsWith("{") || value.startsWith("[")) return false;
	return /[./]/.test(value) || /\.[a-z0-9]{1,8}$/i.test(value);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function urlsFromText(text: string): string[] {
	return [...text.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((match) => match[0]);
}

function pathsFromOutput(name: string, output?: string): string[] {
	if (!output) return [];
	const data = parseJson(output);
	if (!data || typeof data !== "object") return urlsFromText(output);
	const rec = data as Record<string, unknown>;
	if (name === "glob" && Array.isArray(rec.matches)) {
		return rec.matches.filter((item): item is string => typeof item === "string");
	}
	if (name === "grep" && Array.isArray(rec.hits)) {
		const out: string[] = [];
		for (const hit of rec.hits) {
			if (hit && typeof hit === "object" && typeof (hit as { path?: unknown }).path === "string") {
				out.push((hit as { path: string }).path);
			}
		}
		return out;
	}
	if (typeof rec.path === "string") return [rec.path];
	return urlsFromText(output);
}

function kindForTool(name: string): ReplySourceKind | undefined {
	if (WRITE_TOOLS.has(name)) return "edit";
	if (READ_TOOLS.has(name)) return "read";
	if (SEARCH_TOOLS.has(name)) return "search";
	if (/search|firecrawl/i.test(name)) return "web";
	return undefined;
}

function sourceLabel(kind: ReplySourceKind, path: string): string {
	if (kind === "web") return path.replace(/^https?:\/\//, "");
	return path;
}

export function replySourcesForAssistant(lines: StreamLine[], assistantKey: string): ReplySource[] {
	const end = lines.findIndex((line) => line.key === assistantKey);
	if (end < 0) return [];
	let start = 0;
	for (let i = end - 1; i >= 0; i--) {
		if (lines[i]?.type === "user") {
			start = i + 1;
			break;
		}
	}
	const byPath = new Map<string, ReplySource>();
	for (let i = start; i < end; i++) {
		const line = lines[i];
		if (line?.type !== "tool" || line.status !== "ok") continue;
		const kind = kindForTool(line.name);
		if (!kind) continue;
		const fromLabel = LABEL_FILE.exec(line.label)?.[1];
		const fromPreview = looksLikePath(line.preview) ? line.preview : undefined;
		const extra = pathsFromOutput(line.name, line.output);
		const paths =
			kind === "search" || kind === "web"
				? extra.length > 0
					? extra
					: fromLabel
						? [fromLabel]
						: fromPreview
							? [fromPreview]
							: []
				: [fromLabel ?? extra[0] ?? fromPreview].filter(
						(item): item is string => typeof item === "string" && item.length > 0,
					);
		for (const path of paths) {
			const current = byPath.get(path);
			if (current && sourceRank(current.kind) <= sourceRank(kind)) continue;
			byPath.set(path, { kind, path, label: sourceLabel(kind, path) });
		}
	}
	return [...byPath.values()]
		.sort((a, b) => sourceRank(a.kind) - sourceRank(b.kind))
		.slice(0, SOURCE_CAP);
}

function sourceRank(kind: ReplySourceKind): number {
	if (kind === "edit") return 0;
	if (kind === "read") return 1;
	if (kind === "search") return 2;
	return 3;
}
