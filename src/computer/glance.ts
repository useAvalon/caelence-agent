export interface GlanceWindow {
	owner: string;
	title: string;
	id: string;
	width: number;
	height: number;
	front: boolean;
}

const SKIP_OWNER = /caelence/i;

/** Prefer the app named in the request. Otherwise the front window, not the berry. */
export function pickGlanceWindow(
	windows: readonly GlanceWindow[],
	hint: string,
): GlanceWindow | undefined {
	const usable = windows.filter(
		(window) => window.width >= 80 && window.height >= 80 && !SKIP_OWNER.test(window.owner),
	);
	const asked = hint.toLowerCase();
	const named = usable.filter((window) => {
		const owner = window.owner.trim().toLowerCase();
		return owner.length > 2 && asked.includes(owner);
	});
	const pool = named.length > 0 ? named : usable.filter((window) => window.front);
	const list = pool.length > 0 ? pool : usable;
	return [...list].sort((a, b) => b.width * b.height - a.width * a.height)[0];
}
