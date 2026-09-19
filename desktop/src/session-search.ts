export type SessionSort = "newest" | "oldest";

export function sessionMatches(item: { label: string; hint?: string }, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	if (item.label.toLowerCase().includes(q)) return true;
	return (item.hint ?? "").toLowerCase().includes(q);
}

/** Store list is newest-first. Oldest is that order reversed. */
export function sortSessions<T>(items: readonly T[], sort: SessionSort): T[] {
	return sort === "newest" ? items.slice() : items.slice().reverse();
}
