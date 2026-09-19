import { looksLikeWebUrl } from "./rich-text.ts";

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

export function sanitizePreviewHtml(html: string): string {
	return html
		.replace(/<script\b[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[\s\S]*?<\/style>/gi, "")
		.replace(/<(iframe|object|embed|link|meta)\b[\s\S]*?>/gi, "")
		.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
		.replace(/\s(href|src|srcset|xlink:href)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, "");
}

export function renderMarkdown(src: string): string {
	const fences: string[] = [];
	const htmlBlocks: string[] = [];
	let text = src.replace(/\r\n/g, "\n");
	text = text.replace(/^```([\w-]*)\n([\s\S]*?)^```/gm, (_all, _lang: string, code: string) => {
		const id = fences.length;
		fences.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
		return `\n%%FENCE${id}%%\n`;
	});
	text = extractHtmlBlocks(text, htmlBlocks);
	return text
		.split(/\n{2,}/)
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
			if (
				VOID_TAGS.has(tag) ||
				/\/>\s*$/.test(line) ||
				new RegExp(`</${tag}\\s*>`, "i").test(line)
			) {
				chunk.push(line);
				i += 1;
			} else {
				let depth = 1;
				chunk.push(line);
				i += 1;
				const openRe = new RegExp(`<${tag}\\b`, "gi");
				const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
				while (i < lines.length && depth > 0) {
					const next = lines[i] ?? "";
					depth += (next.match(openRe) ?? []).length;
					depth -= (next.match(closeRe) ?? []).length;
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
	if (/^#{1,6}\s/.test(block)) {
		const match = /^(#{1,6})\s+([\s\S]+)$/.exec(block);
		if (match) {
			const level = match[1]?.length ?? 1;
			return `<h${level}>${renderInline(match[2] ?? "")}</h${level}>`;
		}
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
	text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_all, alt: string, href: string) => {
		return `<img src="${href}" alt="${alt}" />`;
	});
	text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_all, label: string, href: string) => {
		return `<a href="${href}">${label}</a>`;
	});
	text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
	text = text.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
	return text.replace(/%%CODE(\d+)%%/g, (_all, id: string) => codes[Number(id)] ?? "");
}
