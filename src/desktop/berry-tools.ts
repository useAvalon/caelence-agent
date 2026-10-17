import { spawn } from "node:child_process";
import {
	errorResult,
	type McpToolAnnotations,
	type McpToolDefinition,
	textResult,
} from "../core/mcp.ts";
import {
	berryUrlAllowed,
	openUrlInRunningBrowser,
	takeBerryScreenAction,
} from "./berry-computer.ts";

/** Opens things on the user's screen. Visible side effect, nothing destroyed. */
const SCREEN_ANNOTATIONS: McpToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
};

export type BerryOpener = (args: string[]) => void;

function macOpen(args: string[]): void {
	spawn("/usr/bin/open", args, { detached: true, stdio: "ignore" }).unref();
}

/** Accepts `https://…`, `http://…`, or a bare domain such as `example.com/path`. */
export function normalizeWebUrl(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (!trimmed || /\s/.test(trimmed)) return undefined;
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
	try {
		const url = new URL(withScheme);
		if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
		if (!url.hostname.includes(".") && url.hostname !== "localhost") return undefined;
		return url.toString();
	} catch {
		return undefined;
	}
}

export function searchUrl(query: string): string {
	return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
}

const APP_NAME = /^[\p{L}\p{N} ._&+-]{1,80}$/u;

export interface BerryToolsOptions {
	/** Off by default for voice berry — search opens a browser tab instead of answering aloud. */
	includeSearch?: boolean;
}

/** Tools the native berry widget adds so the agent acts on screen instead of fetching in the background. */
export function createBerryTools(
	open: BerryOpener = macOpen,
	options: BerryToolsOptions = {},
): McpToolDefinition[] {
	const includeSearch = options.includeSearch ?? false;
	const tools: McpToolDefinition[] = [
		{
			name: "open_url",
			description:
				"Open a page in the browser already on screen, so Arc stays Arc and Chrome stays Chrome.",
			annotations: SCREEN_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "Full URL or bare domain, for example example.com/docs.",
					},
				},
				required: ["url"],
			},
			async handler(raw) {
				const blocked = takeBerryScreenAction("open_url");
				if (blocked) return errorResult(blocked);
				const url = normalizeWebUrl(typeof raw.url === "string" ? raw.url : "");
				if (!url) return errorResult("url must be an http or https address");
				if (!berryUrlAllowed(url)) {
					return errorResult(
						"That address was not in the user's message. Focus the window they named instead of opening a new site.",
					);
				}
				if (open !== macOpen) {
					open([url]);
					return textResult(`Opened ${url} in the browser.`);
				}
				try {
					return textResult(await openUrlInRunningBrowser(url));
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
		{
			name: "open_app",
			description: "Open a Mac app by its name, for example Safari, Mail, or Notes.",
			annotations: SCREEN_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					name: { type: "string" },
				},
				required: ["name"],
			},
			async handler(raw) {
				const blocked = takeBerryScreenAction("open_app");
				if (blocked) return errorResult(blocked);
				const name = typeof raw.name === "string" ? raw.name.trim() : "";
				if (!APP_NAME.test(name)) return errorResult("name must be a plain app name");
				open(["-a", name]);
				return textResult(`Opened ${name}.`);
			},
		},
	];
	if (includeSearch) {
		tools.splice(1, 0, {
			name: "open_search",
			description:
				"Open a Google search results page in the browser. Use only when the user explicitly asks to google or search the web for them — never for general questions you should research and answer yourself.",
			annotations: SCREEN_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string" },
				},
				required: ["query"],
			},
			async handler(raw) {
				const blocked = takeBerryScreenAction("open_search");
				if (blocked) return errorResult(blocked);
				const query = typeof raw.query === "string" ? raw.query.trim() : "";
				if (!query) return errorResult("query is empty");
				const url = searchUrl(query);
				open([url]);
				return textResult(`Opened a search for "${query}" in the browser.`);
			},
		});
	}
	return tools;
}
