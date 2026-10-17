/** Short name for speech — never the raw URL. */
export function spokenSiteName(url: string): string {
	try {
		const parsed = new URL(url.includes("://") ? url : `https://${url}`);
		const host = parsed.hostname.replace(/^www\./, "");
		const brand = host.split(".")[0]?.trim();
		if (!brand) return "that page";
		return brand.charAt(0).toUpperCase() + brand.slice(1);
	} catch {
		return "that page";
	}
}

export function looksLikeAgentInternals(text: string): boolean {
	const lower = text.toLowerCase();
	if (/\bobserve\s*\(|\bact\s*\(|\brun\s*\(/.test(lower)) return true;
	if (lower.includes("frontmost app:") || /\bn\d+\s+button\b/.test(lower)) return true;
	if ((text.match(/https?:\/\//gi) ?? []).length >= 2) return true;
	if (/"kind"\s*:/.test(text)) return true;
	if (/\b(tell application|end tell|keystroke|key code|do shell script|osascript)\b/i.test(text)) {
		return true;
	}
	return false;
}

export function forSpeech(text: string): string | undefined {
	if (looksLikeAgentInternals(text)) return undefined;
	const spoken = text.replace(/https?:\/\/[^\s<>"']+/gi, (url) => spokenSiteName(url));
	return spoken.replace(/:\/\//g, " ").trim() || undefined;
}
