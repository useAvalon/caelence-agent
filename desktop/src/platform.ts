export const PLATFORM_OUTPUT_MAX = 8000;

export function platformPrefix(toolName: string): string | undefined {
	const cut = toolName.indexOf("__");
	if (cut <= 0) return undefined;
	return toolName.slice(0, cut);
}

export function isPlatformTool(toolName: string): boolean {
	return platformPrefix(toolName) !== undefined;
}

export function matchPlatform<T extends { id: string }>(
	toolName: string,
	items: readonly T[],
): T | undefined {
	const prefix = platformPrefix(toolName);
	if (!prefix) return undefined;
	const key = prefix.replaceAll("_", "-").toLowerCase();
	return items.find((item) => item.id.replaceAll("_", "-").toLowerCase() === key);
}

export function platformTitle(
	toolName: string,
	items: ReadonlyArray<{ id: string; label: string }>,
): string {
	const match = matchPlatform(toolName, items);
	if (match) return match.label;
	const prefix = platformPrefix(toolName);
	if (!prefix) return "Integration";
	const label = prefix.replaceAll("_", " ").replaceAll("-", " ").trim();
	return label.length > 0 ? label.charAt(0).toUpperCase() + label.slice(1) : "Integration";
}

export function clipPlatformOutput(text: string): string {
	if (text.length <= PLATFORM_OUTPUT_MAX) return text;
	return `${text.slice(0, PLATFORM_OUTPUT_MAX)}\n…`;
}

export function formatPlatformOutput(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			return JSON.stringify(JSON.parse(trimmed), null, 2);
		} catch {
			return trimmed;
		}
	}
	return trimmed;
}

export function toolEventOutput(result: unknown): string {
	if (typeof result === "string") return clipPlatformOutput(result);
	if (!result || typeof result !== "object") return "";
	const rec = result as Record<string, unknown>;
	if (typeof rec.text === "string") return clipPlatformOutput(rec.text);
	if (Array.isArray(rec.content)) {
		const bits: string[] = [];
		for (const block of rec.content) {
			if (
				block &&
				typeof block === "object" &&
				typeof (block as { text?: unknown }).text === "string"
			) {
				bits.push((block as { text: string }).text);
			}
		}
		if (bits.length > 0) return clipPlatformOutput(bits.join("\n"));
	}
	try {
		return clipPlatformOutput(JSON.stringify(result, null, 2));
	} catch {
		return "";
	}
}
