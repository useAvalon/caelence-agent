/** Tail slice so long input stays on one line (ASCII prompt, no caret glyph). */
export function composerVisibleValue(value: string, width: number, promptLength = 2): string {
	const max = Math.max(1, width - promptLength);
	if (value.length <= max) return value;
	return value.slice(value.length - max);
}
