export function sidebarWidth(columns: number): number {
	return columns >= 88 ? 26 : 0;
}

export const TUI_HEADER_ROWS = 2;
export const TUI_COMPOSER_ROWS = 2;
export const TUI_ACTIVITY_ROWS = 1;

export function visibleTranscriptRows(rows: number, chromeRows: number): number {
	return Math.max(4, rows - Math.max(0, chromeRows));
}

/** @deprecated Line count; prefer visibleTranscriptRows with row-budget clipping. */
export function visibleTranscriptCount(rows: number, chromeRows: number): number {
	return visibleTranscriptRows(rows, chromeRows);
}

export function takeVisibleLines<T>(lines: T[], count: number): T[] {
	if (count <= 0 || lines.length <= count) return lines;
	return lines.slice(lines.length - count);
}

export function clipLabel(text: string, width: number): string {
	const value = text.replace(/\s+/g, " ").trim();
	if (value.length <= width) return value;
	if (width <= 1) return "…";
	return `${value.slice(0, width - 1).trimEnd()}…`;
}

export function tuiChromeRows(input: {
	approval: boolean;
	pickerCount: number;
	slashCount: number;
	activity?: boolean;
}): number {
	let rows = TUI_HEADER_ROWS + TUI_COMPOSER_ROWS;
	if (input.activity) rows += TUI_ACTIVITY_ROWS;
	if (input.approval) rows += 5;
	if (input.pickerCount > 0) rows += Math.min(input.pickerCount, 8) + 2;
	if (input.slashCount > 0) rows += Math.min(input.slashCount, 8) + 1;
	return rows;
}
