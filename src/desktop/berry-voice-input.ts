import { stripBerryModeBanner } from "../decisions/screen-shortcut.ts";

/** Accidental hold-to-speak (silence, dots, ellipsis only) — not a real user turn. */
export function isPlaceholderUserMessage(message: string): boolean {
	const text = stripBerryModeBanner(message).trim();
	if (!text) return true;
	const compact = text.replace(/\s+/g, "");
	if (!compact) return true;
	if (/^[.\u2026……]+$/u.test(compact)) return true;
	if (compact.length <= 2 && /^[.\u2026……?！？]+$/u.test(compact)) return true;
	if (/["“「『].{8,}["”」』]/.test(text) && text.length < 160) return true;
	if (/뉴스|자막|시청해/.test(text)) return true;
	return false;
}
