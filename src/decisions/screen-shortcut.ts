import { normalizeWebUrl } from "../desktop/berry-tools.ts";
import { classifyAgentRoute, type JevRoute } from "./jev.ts";

const APP_NAME = /^[\p{L}\p{N} ._&+-]{1,80}$/u;

export interface ScreenShortcutPlan {
	toolName: "open_url" | "open_search" | "open_app";
	input: Record<string, string>;
	reply: string;
	/** Site was opened so the chat model can create content. Do not end the turn. */
	continueWithAgent?: boolean;
}

export function extractScreenShortcutInput(
	route: JevRoute,
	message: string,
): ScreenShortcutPlan | null {
	const text = message.trim();
	if (route === "agent") return null;

	if (route === "open_url") {
		const url = extractUrl(text) ?? extractOpenWebsiteTarget(text);
		if (!url) return null;
		return {
			toolName: "open_url",
			input: { url },
			reply: `Opened ${url} in your browser.`,
		};
	}

	if (route === "open_search") {
		const query = extractExplicitSearchQuery(text);
		if (!query) return null;
		return {
			toolName: "open_search",
			input: { query },
			reply: `Opened a search for ${query} in your browser.`,
		};
	}

	const app = extractAppName(text);
	if (!app || !APP_NAME.test(app)) return null;
	return {
		toolName: "open_app",
		input: { name: app },
		reply: `Opened ${app}.`,
	};
}

function extractUrl(message: string): string | undefined {
	const explicit = message.match(/https?:\/\/[^\s]+/i)?.[0];
	if (explicit) return normalizeWebUrl(explicit);
	const bare = message.match(
		/\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?/i,
	)?.[0];
	if (bare) return normalizeWebUrl(bare);
	return undefined;
}

/** Only when the user clearly wants a browser search page, not a question for the agent to answer. */
export function extractExplicitSearchQuery(message: string): string | null {
	const google = message.match(
		/\b(?:please\s+)?google\s+(?:for\s+)?(.+?)(?:\s+for\s+me)?\.?$/i,
	)?.[1];
	if (google?.trim()) return google.trim().slice(0, 200);

	const searchFor = message.match(
		/\b(?:please\s+)?search(?:\s+the\s+web)?\s+for\s+(.+?)(?:\s+for\s+me)?\.?$/i,
	)?.[1];
	if (searchFor?.trim()) return searchFor.trim().slice(0, 200);

	const lookOnline = message.match(/\blook\s+up\s+(.+?)\s+(?:on\s+the\s+web|online)\b/i)?.[1];
	if (lookOnline?.trim()) return lookOnline.trim().slice(0, 200);

	return null;
}

const BROWSER_NAMES = new Set(["chrome", "safari", "arc", "firefox", "edge", "brave", "browser"]);
const NOT_A_SITE_NAME = new Set([
	...BROWSER_NAMES,
	"in",
	"on",
	"at",
	"to",
	"for",
	"the",
	"a",
	"an",
	"and",
	"my",
	"it",
	"is",
	"tab",
	"page",
	"site",
	"website",
]);

/** The user is pointing at whatever is already on screen, not naming another place. */
export function asksAboutCurrentScreen(message: string): boolean {
	return (
		/\b(current|already open|this)\b[\s\S]{0,48}\b(window|app|application|screen|tab|chart|page|listing|post|job|article|role)\b/i.test(
			message,
		) ||
		/\b(on (my |the )?screen|look at (the |my )?(screen|window|chart|page)|what('?s| is| does).{0,40}\b(screen|window|chart|indicator|page|listing|post|job))\b/i.test(
			message,
		) ||
		/\b(highlight(?:ed)?|selection|selected text|this text|what (?:does |is )?this (?:say|mean))\b/i.test(
			message,
		)
	);
}

/** A look at the screen when they did not name somewhere else to put the result. */
export function screenQuestionOnly(message: string): boolean {
	if (!asksAboutCurrentScreen(message)) return false;
	if (extractSiteHint(lastUserAsk(message))) return false;
	if (saveTargetName(lastUserAsk(message))) return false;
	if (/(?<!current\s)\b(?:open|go to|visit)\s+(?!my\b)/i.test(message)) return false;
	return true;
}

/** "is open" describes a page already on screen. It is not a request to open one. */
export function saysAlreadyOpen(message: string): boolean {
	return /\b(?:is|was|already|still|it['’]s)\s+open\b/i.test(message);
}

/**
 * A page the user asked to open: "open example", "go to example.com", "open a tab for example".
 * "is open in chrome" is not a request, and "in" is not a site.
 */
function extractOpenWebsiteTarget(message: string): string | undefined {
	const pattern =
		/(?<!(?:is|was|already|still|it['’]s)\s+)\b(?:can you\s+)?(?:please\s+)?(?:open(?:\s+(?:a\s+)?(?:new\s+)?tab(?:\s+(?:for|to))?)?|visit|go\s+to)\s+(?:the\s+)?(?:(?:website|site|page)\s+)?([^\s,]+)/gi;
	for (const match of message.matchAll(pattern)) {
		const target = (match[1] ?? "").trim().replace(/[).]+$/g, "");
		if (!target || NOT_A_SITE_NAME.has(target.toLowerCase())) continue;
		const written = normalizeWebUrl(target);
		if (written) return written;
		if (!/^[a-z0-9][a-z0-9-]{2,62}$/i.test(target)) continue;
		return normalizeWebUrl(`${target.toLowerCase()}.com`);
	}
	return undefined;
}

const CONTENT_TASK =
	/\b(create|write|draft|design|fill|make|template|build|compose|post|publish|tweet)\b/i;

/** Local check so a content task does not wait on Jev before the browser opens. */
export function messageNeedsCreatedContent(message: string): boolean {
	return CONTENT_TASK.test(message);
}

/** Hosts the user wrote, plus a site they explicitly asked to open. */
export function hostsMentioned(message: string): string[] {
	const found = new Set<string>();
	const add = (url: string | undefined) => {
		if (!url) return;
		found.add(new URL(url).hostname.replace(/^www\./, "").toLowerCase());
	};
	for (const match of message.matchAll(/https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}/gi)) {
		add(normalizeWebUrl(match[0].replace(/[),.;]+$/g, "")));
	}
	add(extractOpenWebsiteTarget(message));
	return [...found];
}

/** A URL the user wrote, not a name guessed into a .com address. */
export function extractMentionedSite(message: string): string | undefined {
	if (asksAboutCurrentScreen(message)) return undefined;
	return extractOpenWebsiteTarget(message) ?? extractUrl(message);
}

const NOT_A_HINT = new Set([
	...BROWSER_NAMES,
	"the",
	"a",
	"an",
	"this",
	"that",
	"your",
	"our",
	"my",
	"tab",
	"page",
	"site",
	"current",
	"open",
	"window",
	"app",
	"application",
	"chart",
	"analyze",
	"price",
	"stock",
	"local",
	"mac",
	"macos",
	"new",
	"note",
	"message",
	"doc",
	"document",
	"file",
	"item",
	"create",
	"write",
	"draft",
	"make",
	"add",
	"and",
	"or",
	"but",
	"then",
	"about",
]);

const INVENTED_HOST = new Set([
	"new",
	"page",
	"note",
	"message",
	"doc",
	"document",
	"file",
	"item",
	"create",
	"write",
	"draft",
	"make",
	"add",
]);

/** Reject a host the model invented. The current app is not a website name. */
export function checkNavigate(
	url: string,
	ctx: { task: string; seenHosts: ReadonlySet<string> },
): { ok: true } | { ok: false; message: string } {
	let host = "";
	try {
		host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return { ok: false, message: `Navigation to ${url} blocked: that is not an address.` };
	}
	if (ctx.seenHosts.has(host)) return { ok: true };
	const root = host.split(".")[0] ?? host;
	const task = ctx.task.toLowerCase();
	if (root.length > 2 && !INVENTED_HOST.has(root) && task.includes(root)) return { ok: true };
	return {
		ok: false,
		message: `Navigation to ${host} blocked: the user did not mention it and it has not been seen. If the user wants something created in the current app, use that app's controls. If you need a site you don't know the address of, search for it.`,
	};
}

const BROWSER_IN_MESSAGE: Array<[RegExp, string]> = [
	[/\b(google\s+)?chrome\b/i, "Google Chrome"],
	[/\bbrave\b/i, "Brave Browser"],
	[/\bedge\b/i, "Microsoft Edge"],
	[/\barc\b/i, "Arc"],
	[/\bsafari\b/i, "Safari"],
];

/** "open chrome and go to LinkedIn" → Google Chrome */
export function extractBrowserApp(message: string): string | undefined {
	for (const [pattern, app] of BROWSER_IN_MESSAGE) {
		if (pattern.test(message)) return app;
	}
	return undefined;
}

/** The site to open and read: "go to x.com", not the place the note is saved. */
export function readSite(message: string): string | undefined {
	return extractOpenWebsiteTarget(message) ?? extractUrl(message);
}

/** Last line of a merged follow-up ("do it in notion instead"). */
export function lastUserAsk(message: string): string {
	const lines = message
		.split(/\n+/)
		.map((line) => line.trim())
		.filter(Boolean);
	return lines.at(-1) ?? message;
}

/** Where the finished note goes: a named place after in/on/into. */
export function saveTargetName(message: string): string | undefined {
	const latest = lastUserAsk(message);
	let found: string | undefined;
	for (const match of latest.matchAll(
		/\b(?:in|on|into)\s+(?:a\s+|the\s+)?([A-Za-z][\w-]{1,40})\b/gi,
	)) {
		const word = (match[1] ?? "").toLowerCase();
		if (!word || NOT_A_HINT.has(word) || BROWSER_NAMES.has(word)) continue;
		found = word;
	}
	return found;
}

/** A model refusal, not a note to save. */
export function looksLikeRefusal(text: string): boolean {
	return /\b(cannot access|can't access|do not have access|don't have access|copy the content|paste directly|share them here)\b/i.test(
		text,
	);
}

/** A Mac app they named ("Notes app", "local mac Notes"), not a website. */
export function extractAppHint(message: string): string | undefined {
	const latest = lastUserAsk(message);
	return appHintIn(latest) ?? (latest === message.trim() ? undefined : appHintIn(message));
}

function appHintIn(message: string): string | undefined {
	const patterns = [
		/\b(?:in|into|on|to)\s+(?:the\s+|my\s+)?(?:local\s+)?(?:mac(?:os)?\s+)?([A-Za-z][\w]{1,40})\s+apps?\b/gi,
		/\b(?:local\s+)?mac(?:os)?\s+([A-Za-z][\w]{1,40})\s+apps?\b/gi,
		/\b([A-Za-z][\w]{1,40})\s+apps?\b/gi,
	];
	let found: string | undefined;
	for (const pattern of patterns) {
		for (const match of message.matchAll(pattern)) {
			const word = (match[1] ?? "").trim();
			if (!word || NOT_A_HINT.has(word.toLowerCase()) || BROWSER_NAMES.has(word.toLowerCase())) {
				continue;
			}
			found = word.charAt(0).toUpperCase() + word.slice(1);
		}
		if (found) return found;
	}
	return undefined;
}

/** "write a post on LinkedIn" / "go to example" → that host. Not a hardcoded URL list. */
export function extractSiteHint(message: string): string | undefined {
	if (extractAppHint(message)) return undefined;
	const latest = lastUserAsk(message);
	if (latest !== message.trim()) {
		const fromLatest = siteHintIn(latest);
		if (fromLatest) return fromLatest;
		if (asksAboutCurrentScreen(latest) && !saveTargetName(latest)) return undefined;
	}
	return siteHintIn(message);
}

function siteHintIn(message: string): string | undefined {
	const written = extractMentionedSite(message);
	if (written) return written;
	for (const match of message.matchAll(/\b(?:on|in|at|to)\s+(?:my\s+)?([A-Za-z][\w.-]{0,40})/gi)) {
		const word = match[1] ?? "";
		const after = message.slice((match.index ?? 0) + match[0].length);
		if (/^\s+apps?\b/i.test(after)) continue;
		if (!word || NOT_A_HINT.has(word.toLowerCase()) || BROWSER_NAMES.has(word.toLowerCase())) {
			continue;
		}
		if (word.includes(".")) {
			const url = normalizeWebUrl(word);
			if (url) return url;
			continue;
		}
		if (word.toLowerCase() === "x" || /^[a-z][a-z0-9-]{1,40}$/i.test(word)) {
			const url = normalizeWebUrl(`${word.toLowerCase()}.com`);
			if (url) return url;
		}
	}
	for (const match of message.matchAll(/\b([A-Z][a-z]+[A-Z][a-zA-Z]*)\b/g)) {
		const word = match[1] ?? "";
		if (NOT_A_HINT.has(word.toLowerCase()) || BROWSER_NAMES.has(word.toLowerCase())) continue;
		const url = normalizeWebUrl(`${word.toLowerCase()}.com`);
		if (url) return url;
	}
	return undefined;
}

function extractAppName(message: string): string | undefined {
	const open = message.match(/\bopen\s+(?:the\s+)?(.+?)(?:\s+app)?\.?$/i)?.[1]?.trim();
	if (open && !open.includes("http") && !open.includes("website")) return open;
	const launch = message.match(/\blaunch\s+(.+?)\.?$/i)?.[1]?.trim();
	return launch;
}

export async function planScreenShortcut(input: {
	message: string;
	toolNames: ReadonlySet<string> | readonly string[];
	apiKey: string;
	baseUrl?: string;
	model?: string;
	minConfidence?: number;
	fetchImpl?: typeof fetch;
	/** Berry: Jev opens a named site, then the chat model creates the content. */
	berry?: boolean;
}): Promise<ScreenShortcutPlan | null> {
	const available = input.toolNames instanceof Set ? input.toolNames : new Set(input.toolNames);
	const message = stripBerryModeBanner(input.message);
	if (asksAboutCurrentScreen(message)) return null;
	if (
		input.berry &&
		available.has("open_url") &&
		messageNeedsCreatedContent(message) &&
		!saysAlreadyOpen(message)
	) {
		const site = extractMentionedSite(message);
		if (site) {
			return {
				toolName: "open_url",
				input: { url: site },
				reply: "",
				continueWithAgent: true,
			};
		}
	}
	const classified = await classifyAgentRoute({
		message,
		apiKey: input.apiKey,
		baseUrl: input.baseUrl,
		model: input.model,
		minConfidence: input.minConfidence,
		fetchImpl: input.fetchImpl,
	});
	if (!classified || classified.route === "agent") return null;
	const plan = extractScreenShortcutInput(classified.route, message);
	if (!plan || !available.has(plan.toolName)) return null;
	return plan;
}

/** User message after berry mode prefix (Jev should classify the real utterance). */
export function stripBerryModeBanner(message: string): string {
	const trimmed = message.trim();
	const markers = ["[Berry conversation mode]", "[Berry autonomous mode]"];
	for (const marker of markers) {
		const idx = trimmed.indexOf(marker);
		if (idx === 0) {
			const rest = trimmed.slice(marker.length).trim();
			const split = rest.indexOf("\n\n");
			return (split >= 0 ? rest.slice(split + 2) : rest).trim();
		}
	}
	return trimmed;
}
