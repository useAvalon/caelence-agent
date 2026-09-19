import { looksLikeWebUrl } from "./rich-text";

const VOID_TAGS = new Set([
	"area",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"source",
	"track",
	"wbr",
]);
const INLINE_TAGS = new Set([
	"a",
	"abbr",
	"b",
	"br",
	"code",
	"em",
	"i",
	"span",
	"strong",
	"sub",
	"sup",
]);

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function resolvePreviewAsset(fromFile: string, href: string): string | undefined {
	const raw = href.trim();
	if (!raw || raw.startsWith("#") || raw.startsWith("data:") || raw.startsWith("mailto:")) {
		return undefined;
	}
	if (looksLikeWebUrl(raw) || /^https?:\/\//i.test(raw)) return undefined;
	const file = fromFile.replaceAll("\\", "/").replace(/^\.\//, "");
	const slash = file.lastIndexOf("/");
	const dir = slash >= 0 ? file.slice(0, slash) : "";
	const joined = raw.startsWith("/")
		? raw.replace(/^\/+/, "")
		: [dir, raw.replace(/^\.\//, "")].filter(Boolean).join("/");
	const parts: string[] = [];
	for (const part of joined.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (parts.length === 0) return undefined;
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return parts.join("/") || undefined;
}

export function rewritePreviewAssets(
	html: string,
	fromFile: string,
	hrefFor: (rel: string) => string,
): string {
	return html.replace(/(src|srcset)="([^"]*)"/gi, (all, attr: string, value: string) => {
		if (attr.toLowerCase() === "srcset") {
			const next = value
				.split(",")
				.map((part) => {
					const trimmed = part.trim();
					if (!trimmed) return trimmed;
					const bits = trimmed.split(/\s+/);
					const url = bits[0] ?? "";
					const desc = bits.slice(1).join(" ");
					const rel = resolvePreviewAsset(fromFile, url);
					if (!rel) return trimmed;
					return desc ? `${hrefFor(rel)} ${desc}` : hrefFor(rel);
				})
				.join(", ");
			return `${attr}="${next}"`;
		}
		const rel = resolvePreviewAsset(fromFile, value);
		if (!rel) return all;
		return `${attr}="${hrefFor(rel)}"`;
	});
}

const JS_URL_ATTRS = ["href", "src", "srcset", "xlink:href"] as const;

export function sanitizePreviewHtml(html: string): string {
	let out = stripEnclosedTag(html, "script");
	out = stripEnclosedTag(out, "style");
	for (const tag of ["iframe", "object", "embed", "link", "meta"]) {
		out = stripOpenTag(out, tag);
	}
	return stripJavascriptUrls(stripEventHandlers(out));
}

export function renderMarkdown(src: string): string {
	const fences: string[] = [];
	const htmlBlocks: string[] = [];
	let text = extractFences(src.replaceAll("\r\n", "\n"), fences);
	text = extractHtmlBlocks(text, htmlBlocks);
	return splitBlocks(text)
		.map((block) => {
			const trimmed = block.trim();
			if (!trimmed) return "";
			const fence = /^%%FENCE(\d+)%%$/.exec(trimmed);
			if (fence) return fences[Number(fence[1])] ?? "";
			const html = /^%%HTML(\d+)%%$/.exec(trimmed);
			if (html) return htmlBlocks[Number(html[1])] ?? "";
			return renderBlock(trimmed);
		})
		.filter(Boolean)
		.join("\n");
}

export function renderPreviewHtml(text: string, kind: "markdown" | "html"): string {
	return sanitizePreviewHtml(kind === "html" ? text : renderMarkdown(text));
}

function extractHtmlBlocks(src: string, store: string[]): string {
	const lines = src.split("\n");
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const start = /^\s*<([a-zA-Z][\w-]*)\b/.exec(line);
		const tag = start?.[1]?.toLowerCase();
		if (tag && !INLINE_TAGS.has(tag)) {
			const chunk: string[] = [];
			if (VOID_TAGS.has(tag) || lineEndsWithSelfClose(line) || lineHasCloseTag(line, tag)) {
				chunk.push(line);
				i += 1;
			} else {
				let depth = 1;
				chunk.push(line);
				i += 1;
				while (i < lines.length && depth > 0) {
					const next = lines[i] ?? "";
					depth += countTagOpens(next, tag);
					depth -= countTagCloses(next, tag);
					chunk.push(next);
					i += 1;
				}
			}
			const id = store.length;
			store.push(chunk.join("\n"));
			out.push("", `%%HTML${id}%%`, "");
			continue;
		}
		out.push(line);
		i += 1;
	}
	return out.join("\n");
}

function renderBlock(block: string): string {
	const heading = parseHeading(block);
	if (heading) {
		return `<h${heading.level}>${renderInline(heading.body)}</h${heading.level}>`;
	}
	if (/^[-*_]{3,}$/.test(block)) return "<hr />";
	if (
		/^>\s?/m.test(block) &&
		block.split("\n").every((line) => /^>\s?/.test(line) || !line.trim())
	) {
		const body = block
			.split("\n")
			.map((line) => line.replace(/^>\s?/, ""))
			.join("\n");
		return `<blockquote>${renderBlock(body)}</blockquote>`;
	}
	if (/^[-*]\s+/m.test(block) && block.split("\n").every((line) => /^[-*]\s+/.test(line))) {
		const items = block
			.split("\n")
			.map((line) => `<li>${renderInline(line.replace(/^[-*]\s+/, ""))}</li>`)
			.join("");
		return `<ul>${items}</ul>`;
	}
	if (/^\d+\.\s+/m.test(block) && block.split("\n").every((line) => /^\d+\.\s+/.test(line))) {
		const items = block
			.split("\n")
			.map((line) => `<li>${renderInline(line.replace(/^\d+\.\s+/, ""))}</li>`)
			.join("");
		return `<ol>${items}</ol>`;
	}
	if (isTableBlock(block)) return renderTable(block);
	return `<p>${renderInline(block.replaceAll("\n", " "))}</p>`;
}

function isTableBlock(block: string): boolean {
	const lines = block.split("\n").filter((line) => line.trim());
	if (lines.length < 2) return false;
	return lines.every((line) => line.includes("|"));
}

function renderTable(block: string): string {
	const lines = block.split("\n").filter((line) => line.trim());
	const cells = (line: string) =>
		line
			.replace(/^\||\|$/g, "")
			.split("|")
			.map((cell) => cell.trim());
	const head = cells(lines[0] ?? "");
	const align = cells(lines[1] ?? "");
	const isSep = align.every((cell) => /^:?-+:?$/.test(cell));
	const bodyLines = isSep ? lines.slice(2) : lines.slice(1);
	const th = head.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
	const rows = bodyLines
		.map(
			(line) =>
				`<tr>${cells(line)
					.map((cell) => `<td>${renderInline(cell)}</td>`)
					.join("")}</tr>`,
		)
		.join("");
	return `<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderInline(src: string): string {
	const codes: string[] = [];
	let text = escapeHtml(src);
	text = text.replace(/`([^`]+)`/g, (_all, code: string) => {
		const id = codes.length;
		codes.push(`<code>${code}</code>`);
		return `%%CODE${id}%%`;
	});
	text = rewriteMdMedia(text, true);
	text = rewriteMdMedia(text, false);
	text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
	text = text.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
	return text.replace(/%%CODE(\d+)%%/g, (_all, id: string) => codes[Number(id)] ?? "");
}

function isSpace(ch: string | undefined): boolean {
	return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function codeAt(ch: string | undefined): number {
	return ch?.codePointAt(0) ?? -1;
}

function isWordChar(ch: string | undefined): boolean {
	const code = codeAt(ch);
	return (
		(code >= 48 && code <= 57) ||
		(code >= 65 && code <= 90) ||
		(code >= 97 && code <= 122) ||
		code === 95
	);
}

function isAlpha(ch: string | undefined): boolean {
	const code = codeAt(ch);
	return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function skipSpaces(text: string, i: number): number {
	while (i < text.length && isSpace(text[i])) i += 1;
	return i;
}

function skipQuoted(text: string, i: number, quote: string): number {
	let p = i + 1;
	while (p < text.length && text[p] !== quote) p += 1;
	return p < text.length ? p + 1 : p;
}

function skipUnquotedValue(text: string, i: number): number {
	let p = i;
	while (p < text.length && !isSpace(text[p]) && text[p] !== ">") p += 1;
	return p;
}

function findTagOpen(html: string, tag: string, from: number): number {
	const needle = `<${tag}`;
	const lower = html.toLowerCase();
	let start = from;
	while (start < html.length) {
		const i = lower.indexOf(needle, start);
		if (i < 0) return -1;
		if (!isWordChar(html[i + needle.length])) return i;
		start = i + 1;
	}
	return -1;
}

function stripEnclosedTag(html: string, tag: string): string {
	let out = html;
	while (true) {
		const start = findTagOpen(out, tag, 0);
		if (start < 0) return out;
		const closeNeedle = `</${tag}`;
		const close = out.toLowerCase().indexOf(closeNeedle, start + tag.length + 1);
		if (close < 0) return out.slice(0, start);
		const gt = out.indexOf(">", close + closeNeedle.length);
		if (gt < 0) return out.slice(0, start);
		out = out.slice(0, start) + out.slice(gt + 1);
	}
}

function stripOpenTag(html: string, tag: string): string {
	let out = html;
	while (true) {
		const start = findTagOpen(out, tag, 0);
		if (start < 0) return out;
		const gt = out.indexOf(">", start);
		if (gt < 0) return out.slice(0, start);
		out = out.slice(0, start) + out.slice(gt + 1);
	}
}

function eventHandlerEnd(html: string, spaceStart: number): number | null {
	const nameStart = skipSpaces(html, spaceStart);
	const first = html[nameStart];
	const second = html[nameStart + 1];
	if ((first !== "o" && first !== "O") || (second !== "n" && second !== "N")) return null;
	let k = nameStart + 2;
	while (k < html.length && isAlpha(html[k])) k += 1;
	if (k === nameStart + 2) return null;
	let p = skipSpaces(html, k);
	if (html[p] !== "=") return null;
	p = skipSpaces(html, p + 1);
	const quote = html[p];
	if (quote === '"' || quote === "'") return skipQuoted(html, p, quote);
	return skipUnquotedValue(html, p);
}

function stripEventHandlers(html: string): string {
	let out = "";
	let i = 0;
	while (i < html.length) {
		const end = isSpace(html[i]) ? eventHandlerEnd(html, i) : null;
		if (end !== null) {
			i = end;
			continue;
		}
		out += html[i];
		i += 1;
	}
	return out;
}

function attrNameAt(html: string, afterSpace: number): string | undefined {
	const rest = html.slice(afterSpace).toLowerCase();
	return JS_URL_ATTRS.find((name) => {
		if (!rest.startsWith(name)) return false;
		const next = rest[name.length];
		return !next || next === "=" || isSpace(next);
	});
}

function javascriptUrlEnd(html: string, spaceStart: number): number | null {
	const attr = attrNameAt(html, spaceStart + 1);
	if (!attr) return null;
	let p = skipSpaces(html, spaceStart + 1 + attr.length);
	if (html[p] !== "=") return null;
	p = skipSpaces(html, p + 1);
	const quote = html[p];
	if (quote !== '"' && quote !== "'") return null;
	const valueStart = skipSpaces(html, p + 1);
	if (html.slice(valueStart, valueStart + 11).toLowerCase() !== "javascript:") return null;
	return skipQuoted(html, p, quote);
}

function stripJavascriptUrls(html: string): string {
	let out = "";
	let i = 0;
	while (i < html.length) {
		const end = isSpace(html[i]) ? javascriptUrlEnd(html, i) : null;
		if (end !== null) {
			i = end;
			continue;
		}
		out += html[i];
		i += 1;
	}
	return out;
}

function extractFences(src: string, fences: string[]): string {
	const lines = src.split("\n");
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (line.startsWith("```")) {
			const chunk: string[] = [];
			let j = i + 1;
			while (j < lines.length && !(lines[j] ?? "").startsWith("```")) {
				chunk.push(lines[j] ?? "");
				j += 1;
			}
			if (j < lines.length) {
				const id = fences.length;
				fences.push(`<pre><code>${escapeHtml(chunk.join("\n"))}</code></pre>`);
				out.push("", `%%FENCE${id}%%`, "");
				i = j + 1;
				continue;
			}
		}
		out.push(line);
		i += 1;
	}
	return out.join("\n");
}

function splitBlocks(text: string): string[] {
	const blocks: string[] = [];
	let start = 0;
	let i = 0;
	while (i < text.length) {
		if (text[i] === "\n" && text[i + 1] === "\n") {
			blocks.push(text.slice(start, i));
			while (text[i] === "\n") i += 1;
			start = i;
			continue;
		}
		i += 1;
	}
	blocks.push(text.slice(start));
	return blocks;
}

function lineEndsWithSelfClose(line: string): boolean {
	let i = line.length - 1;
	while (i >= 0 && isSpace(line[i])) i -= 1;
	return i >= 1 && line[i] === ">" && line[i - 1] === "/";
}

function lineHasCloseTag(line: string, tag: string): boolean {
	const needle = `</${tag}`;
	const lower = line.toLowerCase();
	let from = 0;
	while (from < line.length) {
		const i = lower.indexOf(needle, from);
		if (i < 0) return false;
		let p = i + needle.length;
		while (p < line.length && isSpace(line[p])) p += 1;
		if (line[p] === ">") return true;
		from = i + 1;
	}
	return false;
}

function countTagOpens(line: string, tag: string): number {
	const needle = `<${tag}`;
	const lower = line.toLowerCase();
	let n = 0;
	let from = 0;
	while (from < line.length) {
		const i = lower.indexOf(needle, from);
		if (i < 0) return n;
		if (!isWordChar(line[i + needle.length])) n += 1;
		from = i + 1;
	}
	return n;
}

function countTagCloses(line: string, tag: string): number {
	const needle = `</${tag}`;
	const lower = line.toLowerCase();
	let n = 0;
	let from = 0;
	while (from < line.length) {
		const i = lower.indexOf(needle, from);
		if (i < 0) return n;
		let p = i + needle.length;
		while (p < line.length && isSpace(line[p])) p += 1;
		if (line[p] === ">") n += 1;
		from = i + 1;
	}
	return n;
}

function parseHeading(block: string): { level: number; body: string } | null {
	let level = 0;
	while (level < 6 && block[level] === "#") level += 1;
	if (level === 0) return null;
	let i = level;
	if (!isSpace(block[i])) return null;
	while (isSpace(block[i])) i += 1;
	const body = block.slice(i);
	if (!body) return null;
	return { level, body };
}

function hrefEndAt(text: string, start: number): number | null {
	let i = start;
	while (i < text.length && text[i] !== ")") {
		const ch = text[i];
		if (ch === " " || ch === "\t" || ch === "\n") return null;
		i += 1;
	}
	return text[i] === ")" ? i : null;
}

function mediaAt(
	text: string,
	start: number,
	image: boolean,
): { html: string; next: number } | null {
	const labelStart = start + (image ? 2 : 1);
	const labelEnd = text.indexOf("]", labelStart);
	if (labelEnd < 0 || text[labelEnd + 1] !== "(") return null;
	const hrefEnd = hrefEndAt(text, labelEnd + 2);
	if (hrefEnd === null) return null;
	const label = text.slice(labelStart, labelEnd);
	if (!image && !label) return null;
	const href = text.slice(labelEnd + 2, hrefEnd);
	const html = image ? `<img src="${href}" alt="${label}" />` : `<a href="${href}">${label}</a>`;
	return { html, next: hrefEnd + 1 };
}

function rewriteMdMedia(text: string, image: boolean): string {
	const marker = image ? "![" : "[";
	let out = "";
	let i = 0;
	while (i < text.length) {
		const start = text.indexOf(marker, i);
		if (start < 0) {
			out += text.slice(i);
			break;
		}
		out += text.slice(i, start);
		const media = mediaAt(text, start, image);
		if (!media) {
			out += text[start];
			i = start + 1;
			continue;
		}
		out += media.html;
		i = media.next;
	}
	return out;
}
