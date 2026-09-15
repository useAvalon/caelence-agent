export function sidebarWidth(columns: number): number {
	return columns >= 88 ? 26 : 0;
}

export function visibleTranscriptCount(rows: number, chromeRows: number): number {
	return Math.max(3, rows - Math.max(0, chromeRows));
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
}): number {
	return (
		3 +
		2 +
		(input.approval ? 4 : 0) +
		(input.pickerCount > 0 ? Math.min(input.pickerCount, 8) + 2 : 0) +
		(input.slashCount > 0 ? Math.min(input.slashCount, 8) + 1 : 0)
	);
}
