import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { resolveUnderCwd, toProjectRel } from "../tools/paths.ts";
import { composeUploadMessage as buildUploadMessage } from "./upload-message.ts";

export const MAX_UPLOADS = 8;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TEXT_EXCERPT_BYTES = 100_000;
const INDEX_NAME = "index.json";
const MAX_LISTED = 40;

const TEXT_MIME_PREFIXES = [
	"text/",
	"application/json",
	"application/xml",
	"application/javascript",
	"application/sql",
	"application/yaml",
	"application/x-yaml",
	"application/toml",
	"application/x-sh",
	"application/x-httpd-php",
];
const TEXT_EXTS = new Set([
	"txt",
	"md",
	"markdown",
	"json",
	"csv",
	"tsv",
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"css",
	"scss",
	"html",
	"htm",
	"xml",
	"yml",
	"yaml",
	"toml",
	"py",
	"rs",
	"go",
	"sh",
	"bash",
	"zsh",
	"env",
	"svg",
	"log",
	"ini",
	"cfg",
]);

export interface IncomingUpload {
	name: string;
	mime: string;
	data: string;
	sourcePath?: string;
}

export interface SavedUpload {
	name: string;
	rel: string;
	mime: string;
	excerpt?: string;
	sourcePath?: string;
}

export interface UploadRecord {
	name: string;
	rel: string;
	mime: string;
	sourcePath?: string;
	addedAt: string;
}

function incomingFromUnknown(item: unknown): IncomingUpload | undefined {
	if (!item || typeof item !== "object") return undefined;
	const rec = item as Record<string, unknown>;
	const name = typeof rec.name === "string" ? rec.name.trim() : "";
	const data = typeof rec.data === "string" ? rec.data.trim() : "";
	if (!name || !data) return undefined;
	const mime =
		typeof rec.mime === "string" && rec.mime.trim() ? rec.mime.trim() : "application/octet-stream";
	const sourcePath = parseSourcePath(rec.sourcePath);
	return { name, mime, data, ...(sourcePath ? { sourcePath } : {}) };
}

export function parseIncomingUploads(raw: unknown): IncomingUpload[] {
	if (!Array.isArray(raw)) return [];
	const out: IncomingUpload[] = [];
	for (const item of raw) {
		const parsed = incomingFromUnknown(item);
		if (!parsed) continue;
		out.push(parsed);
		if (out.length >= MAX_UPLOADS) break;
	}
	return out;
}

export function parseSourcePath(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const trimmed = raw.trim();
	if (
		!trimmed ||
		trimmed.includes("\0") ||
		trimmed.includes("\n") ||
		trimmed.includes("\r") ||
		trimmed.length > 1024
	) {
		return undefined;
	}
	if (trimmed.startsWith("file://")) return undefined;
	if (trimmed === "~" || trimmed.startsWith("~/")) return trimmed;
	if (isAbsolute(trimmed)) return trimmed;
	return undefined;
}

export function expandSourcePath(raw: string): string {
	if (raw === "~") return homedir();
	if (raw.startsWith("~/")) return resolve(homedir(), raw.slice(2));
	return resolve(raw);
}

export function displaySourcePath(abs: string): string {
	const home = homedir();
	if (abs === home) return "~";
	if (abs.startsWith(`${home}/`)) return `~${abs.slice(home.length)}`;
	return abs;
}

export function isTextUpload(name: string, mime: string): boolean {
	const lowerMime = mime.toLowerCase();
	if (TEXT_MIME_PREFIXES.some((prefix) => lowerMime.startsWith(prefix))) return true;
	const dot = name.lastIndexOf(".");
	if (dot < 0) return false;
	return TEXT_EXTS.has(name.slice(dot + 1).toLowerCase());
}

export function safeUploadName(name: string): string {
	const trimmed = name.trim() || "file";
	const base = trimmed.replace(/[^\w.-]+/g, "_").replace(/^[._]+/, "");
	return (base || "file").slice(0, 120);
}

function uploadsDir(cwd: string): string {
	return resolve(cwd, ".harness", "uploads");
}

function storedDisplayName(filename: string): string {
	return filename.replace(/^\d+-\d+-/, "") || filename;
}

function recordFromUnknown(item: unknown): UploadRecord | undefined {
	if (!item || typeof item !== "object") return undefined;
	const rec = item as Record<string, unknown>;
	const name = typeof rec.name === "string" ? rec.name : "";
	const rel = typeof rec.rel === "string" ? rec.rel : "";
	if (!name || !rel) return undefined;
	const mime = typeof rec.mime === "string" ? rec.mime : "application/octet-stream";
	const addedAt = typeof rec.addedAt === "string" ? rec.addedAt : "";
	const sourcePath = parseSourcePath(rec.sourcePath);
	return { name, rel, mime, addedAt, ...(sourcePath ? { sourcePath } : {}) };
}

function readIndex(dir: string): UploadRecord[] {
	try {
		const parsed: unknown = JSON.parse(readFileSync(resolve(dir, INDEX_NAME), "utf8"));
		if (!parsed || typeof parsed !== "object") return [];
		const files = (parsed as { files?: unknown }).files;
		if (!Array.isArray(files)) return [];
		return files.flatMap((item) => {
			const rec = recordFromUnknown(item);
			return rec ? [rec] : [];
		});
	} catch {
		return [];
	}
}

function writeIndex(dir: string, files: UploadRecord[]): void {
	writeFileSync(resolve(dir, INDEX_NAME), `${JSON.stringify({ files }, null, 2)}\n`);
}

export function listUploads(cwd: string): UploadRecord[] {
	const dir = uploadsDir(cwd);
	const byRel = new Map<string, UploadRecord>();
	for (const item of readIndex(dir)) byRel.set(item.rel, item);
	try {
		for (const name of readdirSync(dir)) {
			if (name === INDEX_NAME) continue;
			const abs = resolve(dir, name);
			if (!statSync(abs).isFile()) continue;
			const rel = toProjectRel(cwd, abs);
			if (byRel.has(rel)) continue;
			byRel.set(rel, {
				name: storedDisplayName(name),
				rel,
				mime: "application/octet-stream",
				addedAt: new Date(statSync(abs).mtimeMs).toISOString(),
			});
		}
	} catch {
		// no uploads folder yet
	}
	return [...byRel.values()]
		.sort((left, right) => right.addedAt.localeCompare(left.addedAt))
		.slice(0, MAX_LISTED);
}

export function listUploadOriginals(cwd: string): string[] {
	const out: string[] = [];
	for (const item of listUploads(cwd)) {
		if (!item.sourcePath) continue;
		out.push(expandSourcePath(item.sourcePath));
	}
	return out;
}

export function matchUploadEdit(
	cwd: string,
	path: string,
): { rel: string; sourcePath: string; name: string } | undefined {
	const trimmed = path.trim();
	if (!trimmed) return undefined;
	const root = resolve(cwd);
	let abs: string | undefined;
	try {
		abs =
			trimmed.startsWith("~") || isAbsolute(trimmed)
				? expandSourcePath(trimmed)
				: resolve(root, trimmed);
	} catch {
		abs = undefined;
	}
	for (const item of listUploads(cwd)) {
		if (!item.sourcePath) continue;
		const original = expandSourcePath(item.sourcePath);
		const copyAbs = resolve(root, item.rel);
		if (
			trimmed === item.rel ||
			trimmed === item.sourcePath ||
			abs === original ||
			abs === copyAbs
		) {
			return { rel: item.rel, sourcePath: original, name: item.name };
		}
	}
	return undefined;
}

function existingSourcePath(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const abs = expandSourcePath(raw);
	return existsSync(abs) ? abs : undefined;
}

function excerptForUpload(item: IncomingUpload, bytes: Buffer): string | undefined {
	if (!isTextUpload(item.name, item.mime) || bytes.byteLength > TEXT_EXCERPT_BYTES) {
		return undefined;
	}
	return bytes.toString("utf8");
}

function writeOneUpload(
	cwd: string,
	dir: string,
	item: IncomingUpload,
	index: number,
): SavedUpload | undefined {
	const bytes = Buffer.from(item.data, "base64");
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return undefined;
	const unique = `${Date.now()}-${index}-${safeUploadName(item.name)}`;
	const abs = resolve(dir, unique);
	writeFileSync(abs, bytes);
	const excerpt = excerptForUpload(item, bytes);
	const sourcePath = existingSourcePath(item.sourcePath);
	return {
		name: item.name,
		rel: toProjectRel(cwd, abs),
		mime: item.mime,
		...(excerpt !== undefined ? { excerpt } : {}),
		...(sourcePath ? { sourcePath } : {}),
	};
}

export function saveUploads(cwd: string, items: IncomingUpload[]): SavedUpload[] {
	if (items.length === 0) return [];
	const dir = uploadsDir(cwd);
	mkdirSync(dir, { recursive: true });
	const saved: SavedUpload[] = [];
	const records = listUploads(cwd);
	for (const item of items) {
		const next = writeOneUpload(cwd, dir, item, saved.length);
		if (!next) continue;
		saved.push(next);
		records.unshift({
			name: next.name,
			rel: next.rel,
			mime: next.mime,
			addedAt: new Date().toISOString(),
			...(next.sourcePath ? { sourcePath: next.sourcePath } : {}),
		});
	}
	writeIndex(dir, records.slice(0, MAX_LISTED));
	return saved;
}

export function deleteUploads(cwd: string, rels: readonly string[]): UploadRecord[] {
	const wanted = new Set(rels.filter((rel) => rel.trim().length > 0));
	if (wanted.size === 0) return listUploads(cwd);
	const dir = uploadsDir(cwd);
	const keep: UploadRecord[] = [];
	for (const item of listUploads(cwd)) {
		if (!wanted.has(item.rel) || !isListedUploadRel(cwd, dir, item.rel)) {
			keep.push(item);
			continue;
		}
		try {
			const abs = resolveUnderCwd(cwd, item.rel);
			if (existsSync(abs) && statSync(abs).isFile()) unlinkSync(abs);
		} catch {
			keep.push(item);
		}
	}
	try {
		writeIndex(dir, keep);
	} catch {
		// no uploads folder
	}
	return keep;
}

function isListedUploadRel(cwd: string, dir: string, rel: string): boolean {
	if (basename(rel) === INDEX_NAME) return false;
	if (!rel.startsWith(".harness/uploads/") || rel.includes("\0")) return false;
	try {
		const abs = resolveUnderCwd(cwd, rel);
		return abs.startsWith(`${dir}/`) && abs !== dir;
	} catch {
		return false;
	}
}

export function composeUploadMessage(text: string, files: SavedUpload[]): string {
	return buildUploadMessage(
		text,
		files.map((file) => ({
			name: file.name,
			rel: file.rel,
			mime: file.mime,
			...(file.excerpt !== undefined ? { excerpt: file.excerpt } : {}),
			...(file.sourcePath ? { original: displaySourcePath(file.sourcePath) } : {}),
		})),
	);
}
