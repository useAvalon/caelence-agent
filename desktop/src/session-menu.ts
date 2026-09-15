export function clampMenuPosition(
	x: number,
	y: number,
	menu: { width: number; height: number },
	viewport: { width: number; height: number },
	pad = 8,
): { x: number; y: number } {
	return {
		x: Math.min(Math.max(pad, x), Math.max(pad, viewport.width - menu.width - pad)),
		y: Math.min(Math.max(pad, y), Math.max(pad, viewport.height - menu.height - pad)),
	};
}
