export function formatSkillInstalls(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
	return String(count);
}

/** Match skill name, source, or a longer description snippet. */
export function skillMatches(
	item: { name: string; source: string; description?: string },
	query: string,
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const name = item.name.toLowerCase();
	if (name.startsWith(q) || name.includes(q)) return true;
	const source = item.source.toLowerCase().replace(/[/@_-]+/g, " ");
	if (source.split(/\s+/).some((word) => word.startsWith(q) || word.includes(q))) return true;
	if (q.length >= 3 && (item.description ?? "").toLowerCase().includes(q)) return true;
	return false;
}

export function omitCatalogSkill<T extends { id: string }>(items: T[], id: string): T[] {
	const key = id.trim().replaceAll("@", "/").toLowerCase();
	return items.filter((item) => item.id.replaceAll("@", "/").toLowerCase() !== key);
}
