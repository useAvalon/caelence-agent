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

export const PICKER_PAGE = 8;
/** Header, picker title, hint, and vertical margins. */
export const PICKER_RESERVED_ROWS = 6;

/** How many picker rows fit in the terminal after chrome. */
export function pickerVisibleRows(terminalRows: number): number {
	return Math.max(4, terminalRows - PICKER_RESERVED_ROWS);
}

/** Visible slice of a long picker, keeping the selected row on screen. */
export function pickerPage<T>(
	items: T[],
	index: number,
	size = PICKER_PAGE,
): { items: T[]; offset: number } {
	if (items.length <= size) return { items, offset: 0 };
	const clamped = Math.min(Math.max(index, 0), items.length - 1);
	const start = Math.min(Math.max(0, clamped - Math.floor(size / 2)), items.length - size);
	return { items: items.slice(start, start + size), offset: start };
}

type InkPickerKey = {
	escape: boolean;
	upArrow: boolean;
	downArrow: boolean;
	tab: boolean;
	shift: boolean;
	return: boolean;
};

/** Arrow keys arrive as ESC+[+A — treat movement before cancel. */
export function inkPickerNav(key: InkPickerKey): "esc" | "enter" | number | undefined {
	if (key.upArrow || (key.tab && key.shift)) return -1;
	if (key.downArrow || key.tab) return 1;
	if (key.return) return "enter";
	if (key.escape) return "esc";
	return undefined;
}

/** Pad to width so Ink does not leave leftover cells from a longer previous row. */
export function paintPickerLine(text: string, width: number): string {
	const max = Math.max(1, width);
	const body = text.length > max ? `${text.slice(0, max - 1)}…` : text;
	return body.padEnd(max, " ");
}
