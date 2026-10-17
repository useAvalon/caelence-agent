import { snapshotLines } from "../snapshot-format.ts";

export function diffSnapshots(previous: string, next: string): string {
	const before = new Set(snapshotLines(previous));
	const after = new Set(snapshotLines(next));
	if (before.size === 0) return next;
	const added: string[] = [];
	const removed: string[] = [];
	for (const line of after) {
		if (!before.has(line)) added.push(line);
	}
	for (const line of before) {
		if (!after.has(line)) removed.push(line);
	}
	const changed = added.length + removed.length;
	const total = Math.max(after.size, 1);
	if (changed > total / 2) return next;
	const header = next.split("\n")[0] ?? "";
	const parts = [header, `DIFF +${added.length} -${removed.length}`];
	if (added.length) parts.push("ADDED", ...added.slice(0, 80));
	if (removed.length) parts.push("REMOVED", ...removed.slice(0, 80));
	if (added.length === 0 && removed.length === 0) parts.push("(unchanged)");
	return parts.join("\n");
}
