import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hostOfUrl } from "./applescript-driver.ts";
import type { BrowserAction } from "./session.ts";

export type RepeatDecision = "ok" | "skip" | "escalate" | "ask";

export function repeatKey(action: BrowserAction): string | undefined {
	if (action.kind === "navigate" && action.url) return `navigate:${hostOfUrl(action.url)}`;
	if (action.kind === "click") {
		const name = (action.name || action.label).trim().toLowerCase();
		return `click:${action.ref ?? ""}:${action.role ?? ""}:${name}`;
	}
	return undefined;
}

/** Second time is skipped. Third escalates. A further repeat asks the user. */
export function repeatDecision(seen: Map<string, number>, key: string): RepeatDecision {
	const next = (seen.get(key) ?? 0) + 1;
	seen.set(key, next);
	if (next <= 1) return "ok";
	if (next === 2) return "skip";
	if (next === 3) return "escalate";
	return "ask";
}

export function siteNoteFile(url: string): string | undefined {
	const host = hostOfUrl(url);
	if (!host || host.includes("..") || host.includes("/")) return undefined;
	return join(homedir(), ".agent", "sites", `${host}.md`);
}

export function readSiteNote(url: string): string | undefined {
	const file = siteNoteFile(url);
	if (!file) return undefined;
	try {
		const text = readFileSync(file, "utf8").trim();
		return text || undefined;
	} catch {
		return undefined;
	}
}

export function writeSiteNote(url: string, note: string): void {
	const file = siteNoteFile(url);
	if (!file) return;
	mkdirSync(join(homedir(), ".agent", "sites"), { recursive: true });
	writeFileSync(file, `${note.trim()}\n`);
}
