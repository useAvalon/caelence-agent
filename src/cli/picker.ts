import type { Session } from "../core/session.ts";

export interface PickerItem {
	id: string;
	label: string;
	hint?: string;
}

export function relativeTime(iso: string, now = Date.now()): string {
	const then = Date.parse(iso);
	if (!Number.isFinite(then)) return iso;
	const min = Math.floor((now - then) / 60_000);
	if (min < 1) return "just now";
	if (min < 60) return `${min} min ago`;
	const hours = Math.floor(min / 60);
	if (hours < 24) return `${hours} h ago`;
	return `${Math.floor(hours / 24)} d ago`;
}

export function sessionPickerItems(sessions: Session[], now = Date.now()): PickerItem[] {
	return sessions.map((session) => ({
		id: session.id,
		label: session.title.trim() || "New chat",
		hint: [relativeTime(session.updatedAt, now), session.model].filter(Boolean).join(" · "),
	}));
}

/** Pick by 1-based list index, title, or id. Empty query means open a picker. */
export function matchListedSession(sessions: Session[], query: string): Session | undefined {
	const value = query.trim();
	if (!value) return undefined;
	if (/^\d+$/.test(value)) {
		const index = Number(value);
		return sessions[index - 1];
	}
	const lower = value.toLowerCase();
	return (
		sessions.find((session) => session.id === value) ??
		sessions.find((session) => session.title.toLowerCase() === lower) ??
		sessions.find((session) => session.title.toLowerCase().startsWith(lower)) ??
		sessions.find((session) => session.title.toLowerCase().includes(lower))
	);
}

export function stepIndex(index: number, count: number, delta: number): number {
	if (count <= 0) return 0;
	return (index + delta + count) % count;
}
