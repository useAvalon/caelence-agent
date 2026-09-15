/** Match the integration name, not the description. Short queries are word prefixes. */
export function integrationMatches(label: string, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const hay = label.toLowerCase();
	if (hay.startsWith(q)) return true;
	return hay.split(/\s+/).some((word) => word.startsWith(q));
}
