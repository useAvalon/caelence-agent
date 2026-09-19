import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { toProjectRel } from "../tools/paths.ts";
import { composeUploadMessage as buildUploadMessage } from "./upload-message.ts";

export const MAX_UPLOADS = 8;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TEXT_EXCERPT_BYTES = 100_000;
const INDEX_NAME = "index.json";
const MAX_LISTED = 40;

const TEXT_MIME =
	/^(text\/|application\/(json|xml|javascript|sql|yaml|x-yaml|toml|x-sh|x-httpd-php))/i;
const TEXT_EXT =
	/\.(txt|md|markdown|json|csv|tsv|ts|tsx|js|jsx|mjs|cjs|css|scss|html|htm|xml|yml|yaml|toml|py|rs|go|sh|bash|zsh|env|svg|log|ini|cfg)$/i;

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

export function parseIncomingUploads(raw: unknown): IncomingUpload[] {
	if (!Array.isArray(raw)) return [];
	const out: IncomingUpload[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const rec = item as Record<string, unknown>;
		const name = typeof rec.name === "string" ? rec.name.trim() : "";
		const data = typeof rec.data === "string" ? rec.data.trim() : "";
		const mime =
			typeof rec.mime === "string" && rec.mime.trim()
				? rec.mime.trim()
				: "application/octet-stream";
		if (!name || !data) continue;
		const sourcePath = parseSourcePath(rec.sourcePath);
		out.push({ name, mime, data, ...(sourcePath ? { sourcePath } : {}) });
		if (out.length >= MAX_UPLOADS) break;
	}
	return out;
}

export function parseSourcePath(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const trimmed = raw.trim();
	if (!trimmed || trimmed.includes("\0") || /\n|\r/.test(trimmed) || trimmed.length > 1024) {
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
	return TEXT_MIME.test(mime) || TEXT_EXT.test(name);
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

function readIndex(dir: string): UploadRecord[] {
	try {
		const parsed: unknown = JSON.parse(readFileSync(resolve(dir, INDEX_NAME), "utf8"));
		if (!parsed || typeof parsed !== "object") return [];
		const files = (parsed as { files?: unknown }).files;
		if (!Array.isArray(files)) return [];
		const out: UploadRecord[] = [];
		for (const item of files) {
			if (!item || typeof item !== "object") continue;
			const rec = item as Record<string, unknown>;
			const name = typeof rec.name === "string" ? rec.name : "";
			const rel = typeof rec.rel === "string" ? rec.rel : "";
			if (!name || !rel) continue;
			const mime = typeof rec.mime === "string" ? rec.mime : "application/octet-stream";
			const addedAt = typeof rec.addedAt === "string" ? rec.addedAt : "";
			const sourcePath = parseSourcePath(rec.sourcePath);
			out.push({
				name,
				rel,
				mime,
				addedAt,
				...(sourcePath ? { sourcePath } : {}),
			});
		}
		return out;
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
		.sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0))
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

export function saveUploads(cwd: string, items: IncomingUpload[]): SavedUpload[] {
	if (items.length === 0) return [];
	const dir = uploadsDir(cwd);
	mkdirSync(dir, { recursive: true });
	const saved: SavedUpload[] = [];
	const records = listUploads(cwd);
	for (const item of items) {
		const bytes = Buffer.from(item.data, "base64");
		if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) continue;
		const unique = `${Date.now()}-${saved.length}-${safeUploadName(item.name)}`;
		const abs = resolve(dir, unique);
		writeFileSync(abs, bytes);
		const rel = toProjectRel(cwd, abs);
		const excerpt =
			isTextUpload(item.name, item.mime) && bytes.byteLength <= TEXT_EXCERPT_BYTES
				? bytes.toString("utf8")
				: undefined;
		const sourcePath = item.sourcePath
			? existsSync(expandSourcePath(item.sourcePath))
				? expandSourcePath(item.sourcePath)
				: undefined
			: undefined;
		saved.push({
			name: item.name,
			rel,
			mime: item.mime,
			...(excerpt !== undefined ? { excerpt } : {}),
			...(sourcePath ? { sourcePath } : {}),
		});
		records.unshift({
			name: item.name,
			rel,
			mime: item.mime,
			addedAt: new Date().toISOString(),
			...(sourcePath ? { sourcePath } : {}),
		});
	}
	writeIndex(dir, records.slice(0, MAX_LISTED));
	return saved;
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
