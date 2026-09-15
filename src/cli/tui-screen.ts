/** DEC alternate screen, same idea as vim / Claude Code fullscreen. */

export const ENTER_ALT_SCREEN = "\x1b[?1049h";
export const LEAVE_ALT_SCREEN = "\x1b[?1049l";
export const SHOW_CURSOR = "\x1b[?25h";

export function enterAltScreen(stdout: NodeJS.WriteStream = process.stdout): () => void {
	if (!stdout.isTTY) return () => undefined;
	stdout.write(ENTER_ALT_SCREEN);
	return () => {
		stdout.write(`${LEAVE_ALT_SCREEN}${SHOW_CURSOR}`);
	};
}
