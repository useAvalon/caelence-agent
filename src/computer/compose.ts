import { hostOfUrl } from "./browser/applescript-driver.ts";
import { parseSnapshotLine, snapshotLines } from "./snapshot-format.ts";

const TAB_CHROME =
	/cookie|sign in|log in|subscribe|accept all|privacy policy|terms of use|skip to|search|notifications?|watch live/i;
const TAB_GENERIC_TITLE =
	/^(breaking news|latest news|top stories|headlines)(,\s*(breaking news|latest news|top stories|headlines))*$/i;

function compactLine(value: string): string {
	return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Drop the user's instruction if it leaked into a snapshot or draft. */
export function withoutAsk(ask: string, source: string): string {
	const compactAsk = compactLine(ask);
	if (compactAsk.length < 12) return source;
	return source
		.split("\n")
		.filter((line) => {
			const compact = compactLine(line);
			if (!compact) return false;
			if (compact === compactAsk) return false;
			if (compactAsk.includes(compact) && compact.length >= 16) return false;
			if (compact.includes(compactAsk)) return false;
			return true;
		})
		.join("\n");
}

/** Headlines and readable lines from a tab snapshot, skipping chrome. */
export function tabReadingText(snapshot: string): string {
	const names: string[] = [];
	const seen = new Set<string>();
	const add = (raw: string) => {
		const name = raw.replace(/\s+/g, " ").trim();
		if (name.length < 16 || name.length > 200) return;
		if (TAB_CHROME.test(name) || TAB_GENERIC_TITLE.test(name)) return;
		const key = name.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		names.push(name);
	};
	for (const line of snapshot.split("\n")) {
		const parsed = parseSnapshotLine(line.trim());
		if (parsed) {
			add(parsed.name);
			continue;
		}
		if (/^title:\s*(.+)/i.test(line.trim())) {
			add(line.replace(/^title:\s*/i, ""));
			continue;
		}
		if (/^(frontmost app:|url:|modal )/i.test(line.trim())) continue;
		add(line);
	}
	return names.slice(0, 24).join("\n");
}

export function stripDraftWrapper(text: string): string {
	return text
		.replace(/^["“]+|["”]+$/g, "")
		.replace(/^(here(?:'s| is) (?:a |the )?post:?\s*)/i, "")
		.trim();
}

export function extractQuotedCopy(message: string): string | undefined {
	const match = message.match(/[“"]([^”"]{3,})[”"]/);
	return match?.[1]?.trim();
}

export function extractComposeBody(message: string, siteUrl?: string): string {
	const quoted = extractQuotedCopy(message);
	if (quoted) return quoted;
	let text = message.trim();
	if (siteUrl) {
		const host = hostOfUrl(siteUrl);
		const brand = host.replace(/\.(com|org|net|io)$/i, "").replaceAll(".", "\\.");
		text = text.replace(new RegExp(`\\b(?:https?:\\/\\/)?(?:www\\.)?${host}\\S*`, "gi"), " ");
		text = text.replace(new RegExp(`\\b(?:on|in|at|to|open)\\s+${brand}\\b`, "gi"), " ");
	}
	text = text.replace(/\b(please|can you|could you|would you)\b/gi, " ");
	text = text.replace(/\b(open|go to|visit|launch)\b/gi, " ");
	text = text.replace(
		/\b(draft|write|compose|create|make|post|publish)\s+(a\s+|an\s+)?(post|update|tweet|thread|message|some content|content)?\b/gi,
		" ",
	);
	text = text.replace(/^\s*(and|that says|saying|about|regarding|:)\s*/i, " ");
	return text.replace(/\s+/g, " ").trim();
}

/** True when leftover text is still the ask, not the post to type. */
export function shouldGeneratePost(
	message: string,
	quoted: string | undefined,
	body: string,
): boolean {
	if (quoted) return false;
	if (/\b(about|regarding)\b/i.test(message)) return true;
	if (/\b(open|write|draft|create|compose|post)\b/i.test(message)) {
		return true;
	}
	if (!body || body.length < 40) return true;
	if (/^(open|write|draft|and)\b/i.test(body)) return true;
	return false;
}

const BROWSER_CHROME_FIELD =
	/\b(search|address|url|new tab|open |find in|jump to|command|little arc|omnibox|smartbar)\b|https?:\/\//i;
const POST_FIELD =
	/share your thoughts|what.?s on your mind|what do you want to talk about|start a post|write something|create a post|text editor/i;

export function isBrowserChromeField(name: string): boolean {
	return BROWSER_CHROME_FIELD.test(name);
}

export function textboxRefFromSnapshot(text: string): string | undefined {
	const parsed = snapshotLines(text)
		.map(parseSnapshotLine)
		.filter((line): line is NonNullable<typeof line> => Boolean(line))
		.filter((line) => line.role === "textbox" && !isBrowserChromeField(line.name));
	return parsed.find((line) => POST_FIELD.test(line.name))?.ref;
}

const NEW_DOCUMENT = /\b(new|create|add)\b/i;
const NEW_OBJECT = /\b(page|doc|document|note|item|file)\b/i;
const BROWSER_CHROME_NEW = /\b(tab|window)\b/i;

export function wantsNewDocument(message: string): boolean {
	return (
		/\b(create|start|make)\b.{0,32}\b(page|doc|document|note|file)\b/i.test(message) ||
		/\bnew\b.{0,16}\b(page|doc|document|note)\b/i.test(message)
	);
}

export function newDocumentRef(text: string): string | undefined {
	for (const line of snapshotLines(text)) {
		const parsed = parseSnapshotLine(line);
		if (!parsed) continue;
		const name = parsed.name.trim();
		if (!name || isBrowserChromeField(name)) continue;
		if (BROWSER_CHROME_NEW.test(name) && !NEW_OBJECT.test(name)) continue;
		if (NEW_DOCUMENT.test(name) && NEW_OBJECT.test(name)) return parsed.ref;
		if (/^(new|create|add|\+)$/i.test(name)) return parsed.ref;
	}
	return undefined;
}

const TOPIC_STOP = new Set([
	"write",
	"about",
	"the",
	"and",
	"for",
	"with",
	"into",
	"from",
	"page",
	"post",
	"draft",
	"please",
	"this",
	"that",
	"current",
	"tab",
	"open",
	"site",
	"into",
	"from",
	"with",
	"your",
	"to",
	"go",
	"in",
]);

export function pageTopic(snapshot: string): string {
	const title = snapshot
		.split("\n")
		.find((line) => /^TITLE[:\s]/i.test(line))
		?.replace(/^TITLE:?\s*/i, "")
		.trim();
	const body = snapshotLines(snapshot)
		.map(parseSnapshotLine)
		.filter((line): line is NonNullable<typeof line> => Boolean(line))
		.filter((line) => line.role === "textbox" && !isBrowserChromeField(line.name))
		.sort((a, b) => b.name.length - a.name.length)[0];
	const topic = body && body.name.trim().length > (title?.length ?? 0) ? body.name : (title ?? "");
	return topic.replace(/\s+/g, " ").trim().slice(0, 80);
}

const BLANK_TITLE =
	/^(new page|untitled|untitled page|new doc|new document|new note|page|document)$/i;

/** The open tab is already an empty page, so typing belongs there. */
export function pageIsBlank(title: string): boolean {
	const raw = title.trim();
	if (!raw) return true;
	const page = documentTitle(raw);
	if (!page) return true;
	return BLANK_TITLE.test(page);
}

/** Drop a trailing site name so "Apples | Example" is the page title. */
export function documentTitle(raw: string): string {
	const parts = raw
		.split(/\s*[|–—]\s*/)
		.map((part) => part.trim())
		.filter(Boolean);
	const page = parts.length > 1 ? parts.slice(0, -1).join(" ") : (parts[0] ?? "");
	if (/^(new tab|untitled|home)$/i.test(page)) return "";
	return page.slice(0, 80);
}
/** True when the request is about the same thing as the open page, or the page has no topic yet. */
export function subjectFitsPage(request: string, topic: string): boolean {
	const cleaned = topic.trim();
	if (cleaned.length < 2) return true;
	const words = request
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length >= 2 && !TOPIC_STOP.has(word));
	if (words.length === 0) return true;
	const hay = ` ${cleaned.toLowerCase()} `;
	return words.some((word) => hay.includes(` ${word} `));
}

/** The needle is in a page field, not merely somewhere else on the screen. */
export function fieldHasNeedle(snapshot: string, needle: string): boolean {
	const sample = needle.trim();
	if (!sample) return false;
	return snapshotLines(snapshot)
		.map(parseSnapshotLine)
		.some(
			(line) =>
				line?.role === "textbox" && !isBrowserChromeField(line.name) && line.name.includes(sample),
		);
}

export function pageAlreadyHasWriting(text: string): boolean {
	return snapshotLines(text)
		.map(parseSnapshotLine)
		.filter((line): line is NonNullable<typeof line> => Boolean(line))
		.some(
			(line) =>
				line.role === "textbox" && !isBrowserChromeField(line.name) && line.name.trim().length > 40,
		);
}

/** An unnamed text field that is not the address bar. */
export function emptyEditorRef(text: string): string | undefined {
	const named = textboxRefFromSnapshot(text);
	if (named) return named;
	const parsed = snapshotLines(text)
		.map(parseSnapshotLine)
		.filter((line): line is NonNullable<typeof line> => Boolean(line));
	return parsed.find(
		(line) => line.role === "textbox" && !line.name.trim() && !isBrowserChromeField(line.name),
	)?.ref;
}
