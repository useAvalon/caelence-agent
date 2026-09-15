export type RichPart =
	| { type: "text"; text: string }
	| { type: "link"; href: string; label: string }
	| { type: "file"; path: string; label: string }
	| { type: "image"; src: string; alt: string };

const MD_LINK = /\[([^\]]+)\]\(((?:https?:\/\/|file:\/\/|~\/|\/)[^)\s]+)\)/gi;
const BARE_URL = /https?:\/\/[^\s<>"'\])]+/gi;
const DIR_REF =
	/(?:^|[\s(])((?:~|\/(?:Users|home|Volumes|private|tmp|opt|var|Applications|Library))[^\s):,]*)/g;

export function isImageUrl(href: string): boolean {
	try {
		const url = new URL(href);
		if (/\.(png|jpe?g|gif|webp|svg)$/i.test(url.pathname)) return true;
		if (url.hostname === "media.canva.com") return true;
		if (url.pathname.includes("/document-image")) return true;
		return false;
	} catch {
		return false;
	}
}

export function canvaViewUrl(href: string): string | undefined {
	try {
		const url = new URL(href);
		if (url.hostname === "www.canva.com" || url.hostname === "canva.com") {
			const short = /^\/d\/([^/]+)/.exec(url.pathname)?.[1];
			if (short) return `https://www.canva.com/d/${short}`;
		}
		const designId = /\/id:([^/]+)/.exec(url.pathname)?.[1];
		if (url.hostname === "media.canva.com" && designId) {
			return `https://www.canva.com/design/${designId}/view`;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function linkLabel(href: string): string {
	try {
		const url = new URL(href);
		const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
		return `${url.host}${path}`;
	} catch {
		return href;
	}
}

export function isLocalFileHref(href: string): boolean {
	if (href.startsWith("file:")) return true;
	if (href.startsWith("~/") || href === "~") return true;
	return /^(?:\/(?:Users|home|Volumes|private|tmp|opt|var|Applications|Library)(?:\/|$))/.test(
		href,
	);
}

export function joinLocalPath(dir: string, name: string): string {
	if (isLocalFileHref(name) || name.startsWith("./") || name.startsWith("../")) return name;
	return `${dir.replace(/\/+$/, "")}/${name}`;
}

export function looksLikeFilename(name: string): boolean {
	if (!name || name.length > 240) return false;
	if (isLocalFileHref(name) || name.includes("/")) return true;
	return /\.[A-Za-z0-9]{1,10}$/.test(name);
}

export function splitRichText(text: string): RichPart[] {
	if (!text) return [];
	const taken: Array<{ start: number; end: number; part: RichPart }> = [];

	for (const match of text.matchAll(MD_LINK)) {
		const hrefRaw = match[2];
		const label = match[1];
		if (!hrefRaw || label === undefined || match.index === undefined) continue;
		const href = decodeHref(hrefRaw);
		taken.push({
			start: match.index,
			end: match.index + match[0].length,
			part: fileOrWebPart(href, label || (isLocalFileHref(href) ? href : linkLabel(href))),
		});
	}

	for (const match of text.matchAll(BARE_URL)) {
		if (match.index === undefined) continue;
		const start = match.index;
		const end = start + match[0].length;
		if (overlaps(taken, start, end)) continue;
		const href = decodeHref(trimTrailingPunct(match[0]));
		taken.push({
			start,
			end: start + href.length,
			part: isImageUrl(href)
				? { type: "image", src: href, alt: "Preview" }
				: { type: "link", href, label: linkLabel(href) },
		});
	}

	for (const hit of collectLocalFiles(text)) {
		if (overlaps(taken, hit.start, hit.end)) continue;
		taken.push({
			start: hit.start,
			end: hit.end,
			part: { type: "file", path: hit.path, label: hit.label },
		});
	}

	taken.sort((a, b) => a.start - b.start);
	const parts: RichPart[] = [];
	let cursor = 0;
	for (const item of taken) {
		if (item.start > cursor) {
			parts.push({ type: "text", text: text.slice(cursor, item.start) });
		}
		parts.push(item.part);
		cursor = item.end;
	}
	if (cursor < text.length) parts.push({ type: "text", text: text.slice(cursor) });
	return parts.length > 0 ? parts : [{ type: "text", text }];
}

function fileOrWebPart(href: string, label: string): RichPart {
	if (isLocalFileHref(href)) return { type: "file", path: href, label };
	if (isImageUrl(href)) return { type: "image", src: href, alt: label };
	return { type: "link", href, label };
}

function overlaps(
	taken: Array<{ start: number; end: number }>,
	start: number,
	end: number,
): boolean {
	return taken.some((item) => start < item.end && end > item.start);
}

function collectLocalFiles(
	text: string,
): Array<{ start: number; end: number; path: string; label: string }> {
	const hits: Array<{ start: number; end: number; path: string; label: string }> = [];
	const dirs: Array<{ start: number; path: string }> = [];

	for (const match of text.matchAll(DIR_REF)) {
		const raw = match[1];
		if (!raw || match.index === undefined) continue;
		const start = match.index + match[0].length - raw.length;
		const path = trimTrailingPunct(raw).replace(/\/+$/, "") || raw;
		if (path.length < 2) continue;
		dirs.push({ start, path });
		hits.push({ start, end: start + raw.length, path, label: path });
	}

	let cursor = 0;
	for (const line of text.split("\n")) {
		const prefix = /^(\s*(?:\d+\.|[-*])\s+)/u.exec(line);
		if (prefix) {
			const restStart = prefix[0].length;
			const dash = line.search(/\s+[—–]\s+/u);
			const name = (dash >= restStart ? line.slice(restStart, dash) : line.slice(restStart)).trim();
			if (looksLikeFilename(name)) {
				const nearby = [...dirs].reverse().find((dir) => dir.start <= cursor) ?? dirs[0];
				const path =
					isLocalFileHref(name) || name.includes("/")
						? name
						: nearby
							? joinLocalPath(nearby.path, name)
							: "";
				if (path) {
					const start = cursor + restStart + line.slice(restStart).indexOf(name);
					hits.push({ start, end: start + name.length, path, label: name });
				}
			}
		}
		cursor += line.length + 1;
	}

	hits.sort((a, b) => a.start - b.start || a.end - b.end);
	const out: typeof hits = [];
	for (const hit of hits) {
		if (out.some((item) => hit.start < item.end && hit.end > item.start)) continue;
		out.push(hit);
	}
	return out;
}

function decodeHref(raw: string): string {
	return raw.replaceAll("&amp;", "&");
}

function trimTrailingPunct(raw: string): string {
	return raw.replace(/[.,;:!?]+$/u, "");
}
