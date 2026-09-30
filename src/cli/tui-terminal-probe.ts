import { readLightTerminalOverride, terminalPrefersLightBackground } from "./theme.ts";

function channel(value: string): number {
	const trimmed = value.trim();
	if (!trimmed) return 0;
	if (trimmed.includes("/")) {
		const max = 16 ** trimmed.length - 1;
		const n = Number.parseInt(trimmed, 16);
		return Number.isNaN(n) ? 0 : n / max;
	}
	if (trimmed.length <= 2) {
		const n = Number.parseInt(trimmed, 16);
		return Number.isNaN(n) ? 0 : n / 255;
	}
	const n = Number.parseInt(trimmed, 16);
	const max = 16 ** trimmed.length - 1;
	return Number.isNaN(n) ? 0 : n / max;
}

/** Relative luminance 0–1 from an OSC 11 background report. */
export function luminanceFromOsc11(payload: string): number | undefined {
	const text = payload.trim();
	const rgbParts = /^rgb:([^/]+)\/([^/]+)\/([^/]+)/i.exec(text);
	if (rgbParts) {
		const r = channel(rgbParts[1] ?? "0");
		const g = channel(rgbParts[2] ?? "0");
		const b = channel(rgbParts[3] ?? "0");
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	}
	const hex = /^#?([0-9a-f]{6})$/i.exec(text);
	if (hex?.[1]) {
		const value = hex[1];
		const r = channel(value.slice(0, 2));
		const g = channel(value.slice(2, 4));
		const b = channel(value.slice(4, 6));
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	}
	return undefined;
}

function parseOsc11FromBuffer(buffer: string): number | undefined {
	const start = buffer.indexOf("\x1b]11;");
	if (start < 0) return undefined;
	const end = buffer.indexOf("\x07", start);
	if (end < 0) return undefined;
	const body = buffer.slice(start + 5, end);
	return luminanceFromOsc11(body);
}

/** OSC 11 background luminance query on the **current** screen (call before alt-screen). */
export function queryOsc11BackgroundLight(
	stdin: NodeJS.ReadStream = process.stdin,
	stdout: NodeJS.WriteStream = process.stdout,
	timeoutMs = 250,
): Promise<boolean | undefined> {
	if (!stdin.isTTY || !stdout.isTTY) return Promise.resolve(undefined);

	return new Promise((resolve) => {
		let buffer = "";
		let raw = false;
		const timeout = setTimeout(() => finish(undefined), timeoutMs);

		const finish = (light: boolean | undefined) => {
			clearTimeout(timeout);
			stdin.off("data", onData);
			if (raw && stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false);
			resolve(light);
		};

		const onData = (chunk: Buffer | string) => {
			buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
			const lum = parseOsc11FromBuffer(buffer);
			if (lum === undefined) return;
			finish(lum > 0.55);
		};

		if (stdin.isTTY && stdin.setRawMode) {
			stdin.setRawMode(true);
			raw = true;
		}
		stdin.on("data", onData);
		stdout.write("\x1b]11;?\x07");
	});
}

/**
 * Best-effort light/dark detection for TUI contrast.
 * Run on the main screen before switching to the alt buffer.
 */
export async function detectLightTerminalBackground(
	env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
	const explicit = readLightTerminalOverride(env);
	if (explicit !== undefined) return explicit;
	if (terminalPrefersLightBackground(env)) return true;

	const osc = await queryOsc11BackgroundLight();
	if (osc !== undefined) return osc;

	// Cursor / IDE terminals often omit COLORFGBG and ignore OSC on the alt screen.
	return true;
}

/** Env for `resolveTheme` after TUI detection (respects explicit overrides). */
export async function resolveTuiThemeEnv(
	env: Record<string, string | undefined> = process.env,
): Promise<Record<string, string | undefined>> {
	const out = { ...env };
	if (readLightTerminalOverride(out) !== undefined) return out;
	const light = await detectLightTerminalBackground(out);
	out.CAELENCE_LIGHT_TERMINAL = light ? "1" : "0";
	return out;
}
