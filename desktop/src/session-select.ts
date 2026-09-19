export function pruneSelected(
	prev: ReadonlySet<string>,
	live: ReadonlySet<string>,
): ReadonlySet<string> {
	let changed = false;
	const next = new Set<string>();
	for (const id of prev) {
		if (live.has(id)) next.add(id);
		else changed = true;
	}
	return changed ? next : prev;
}

export function toggleOne(prev: ReadonlySet<string>, id: string): ReadonlySet<string> {
	const next = new Set(prev);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

export function toggleVisible(
	prev: ReadonlySet<string>,
	visibleIds: readonly string[],
	allSelected: boolean,
): ReadonlySet<string> {
	const next = new Set(prev);
	for (const id of visibleIds) {
		if (allSelected) next.delete(id);
		else next.add(id);
	}
	return next;
}
