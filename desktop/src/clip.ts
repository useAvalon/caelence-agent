export function clipNeedsExpand(
	contentHeight: number,
	collapsedHeight: number,
	lineHeight: number,
): boolean {
	if (contentHeight <= 0 || collapsedHeight <= 0) return false;
	const hidden = contentHeight - collapsedHeight;
	const slop = Math.max(8, lineHeight * 1.15);
	return hidden > slop;
}

export function collapsedClipLimit(node: HTMLElement): number {
	const style = getComputedStyle(node);
	const raw = style.getPropertyValue("--desk-clip-max").trim() || style.maxHeight;
	const fontSize = parseFloat(style.fontSize);
	if (raw.endsWith("em") && Number.isFinite(fontSize)) return parseFloat(raw) * fontSize;
	if (raw.endsWith("px")) return parseFloat(raw);
	return node.clientHeight;
}

export function clipLineHeight(node: HTMLElement): number {
	const line = parseFloat(getComputedStyle(node).lineHeight);
	if (Number.isFinite(line) && line > 0) return line;
	const fontSize = parseFloat(getComputedStyle(node).fontSize);
	return Number.isFinite(fontSize) ? fontSize * 1.45 : 20;
}
