import {
	asksAboutCurrentScreen,
	extractAppHint,
	extractSiteHint,
	lastUserAsk,
	readSite,
	saveTargetName,
} from "../decisions/screen-shortcut.ts";
import { hostOfUrl } from "./browser/applescript-driver.ts";
import { decideCatalog, isolatedName } from "./capability.ts";

export type ScreenWork = {
	source: "front" | "url" | "none";
	readUrl?: string;
	put: "reply" | "catalog" | "site" | "app";
	dest?: string;
};

/**
 * Where to read from and where to put the result.
 * Named places decide the sink; pointing at the open tab decides the source.
 */
export function planScreenWork(message: string): ScreenWork {
	const latest = lastUserAsk(message);
	const app =
		extractAppHint(latest) ??
		(asksAboutCurrentScreen(latest) ? undefined : extractAppHint(message));
	const dest =
		extractSiteHint(latest) ??
		(asksAboutCurrentScreen(latest) ? undefined : extractSiteHint(message));
	const match = decideCatalog({
		task: latest,
		host: dest,
		askedHost: dest,
	});
	const front = asksAboutCurrentScreen(latest);
	const readUrl = readSite(latest) ?? (!front ? readSite(message) : undefined);
	const save = saveTargetName(latest);

	if (match && (save || dest || isolatedName(latest, match.label))) {
		const elsewhere = Boolean(readUrl) && dest && hostOfUrl(readUrl) !== hostOfUrl(dest);
		return {
			source: elsewhere ? "url" : "front",
			readUrl: elsewhere ? readUrl : undefined,
			put: "catalog",
			dest,
		};
	}
	if (app) {
		const elsewhere = Boolean(readUrl);
		return {
			source: elsewhere ? "url" : "front",
			readUrl: elsewhere ? readUrl : undefined,
			put: "app",
			dest: app,
		};
	}
	if (dest) {
		const elsewhere = Boolean(readUrl) && hostOfUrl(readUrl) !== hostOfUrl(dest);
		return {
			source: elsewhere ? "url" : "front",
			readUrl: elsewhere ? readUrl : undefined,
			put: "site",
			dest,
		};
	}
	if (front) return { source: "front", put: "reply" };
	if (readUrl) return { source: "url", readUrl, put: "reply" };
	return { source: "none", put: "reply" };
}
