import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { toProjectRel } from "../tools/paths.ts";

export const MAX_UPLOADS = 8;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TEXT_EXCERPT_BYTES = 100_000;

const TEXT_MIME =
	/^(text\/|application\/(json|xml|javascript|sql|yaml|x-yaml|toml|x-sh|x-httpd-php))/i;
const TEXT_EXT =
	/\.(txt|md|markdown|json|csv|tsv|ts|tsx|js|jsx|mjs|cjs|css|scss|html|htm|xml|yml|yaml|toml|py|rs|go|sh|bash|zsh|env|svg|log|ini|cfg)$/i;

export interface IncomingUpload {
	name: string;
	mime: string;
	data: string;
}

export interface SavedUpload {
	name: string;
	rel: string;
	mime: string;
	excerpt?: string;
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
		out.push({ name, mime, data });
		if (out.length >= MAX_UPLOADS) break;
	}
	return out;
}

export function isTextUpload(name: string, mime: string): boolean {
	return TEXT_MIME.test(mime) || TEXT_EXT.test(name);
}

export function safeUploadName(name: string): string {
	const trimmed = name.trim() || "file";
	const base = trimmed.replace(/[^\w.-]+/g, "_").replace(/^[._]+/, "");
	return (base || "file").slice(0, 120);
}

export function saveUploads(cwd: string, items: IncomingUpload[]): SavedUpload[] {
	if (items.length === 0) return [];
	const dir = resolve(cwd, ".harness", "uploads");
	mkdirSync(dir, { recursive: true });
	const saved: SavedUpload[] = [];
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
		saved.push({
			name: item.name,
			rel,
			mime: item.mime,
			...(excerpt !== undefined ? { excerpt } : {}),
		});
	}
	return saved;
}

export function composeUploadMessage(text: string, files: SavedUpload[]): string {
	if (files.length === 0) return text;
	const blocks = files.map((file) => {
		if (file.excerpt !== undefined) {
			return `Attached \`${file.rel}\` (${file.name}):\n\n\`\`\`\n${file.excerpt}\n\`\`\``;
		}
		return `Attached \`${file.rel}\` (${file.name}, ${file.mime}). Use that project path.`;
	});
	const body = text.trim();
	return body ? `${body}\n\n${blocks.join("\n\n")}` : blocks.join("\n\n");
}
