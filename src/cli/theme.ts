export type ThemeName = "caelence" | "plain";

export interface Theme {
	name: string;
	brand: string;
	action: string;
	ink: string;
	muted: string;
	line: string;
	danger: string;
	warning: string;
	done: string;
}

/** Dark-terminal mapping of Caelence role colours. */
export const CAELENCE_THEME: Theme = {
	name: "caelence",
	brand: "#6e93b8",
	action: "#6e93b8",
	ink: "#E8E4DC",
	muted: "#9A958C",
	line: "#5C5A55",
	danger: "#E4796E",
	warning: "#D4A054",
	done: "#6e93b8",
};

/** Light-terminal mapping (dark ink on pale backgrounds). */
export const CAELENCE_LIGHT_THEME: Theme = {
	name: "caelence",
	brand: "#3d5a73",
	action: "#3d5a73",
	ink: "#1a1814",
	muted: "#5c574f",
	line: "#8a847a",
	danger: "#b54a3f",
	warning: "#9a6b1a",
	done: "#3d5a73",
};

export const PLAIN_THEME: Theme = {
	name: "plain",
	brand: "blue",
	action: "blue",
	ink: "white",
	muted: "gray",
	line: "gray",
	danger: "red",
	warning: "yellow",
	done: "blue",
};

export const PLAIN_LIGHT_THEME: Theme = {
	name: "plain",
	brand: "blue",
	action: "blue",
	ink: "black",
	muted: "gray",
	line: "gray",
	danger: "red",
	warning: "yellow",
	done: "blue",
};

/**
 * Explicit CAELENCE_LIGHT_TERMINAL when set; otherwise undefined (auto-detect).
 * `1` = pale terminal background (dark ink). `0` = dark background (pale ink).
 */
export function readLightTerminalOverride(
	env: Record<string, string | undefined>,
): boolean | undefined {
	const raw = env.CAELENCE_LIGHT_TERMINAL?.trim().toLowerCase();
	if (raw === "1" || raw === "true" || raw === "yes") return true;
	if (raw === "0" || raw === "false" || raw === "no") return false;
	return undefined;
}

export function terminalPrefersLightBackground(
	env: Record<string, string | undefined> = process.env,
): boolean {
	const override = readLightTerminalOverride(env);
	if (override !== undefined) return override;
	const raw = env.COLORFGBG?.trim();
	if (!raw) return false;
	const parts = raw.split(";").map((part) => Number.parseInt(part, 10));
	const bg = parts.length >= 2 ? parts[1] : parts.at(-1);
	if (bg === undefined || Number.isNaN(bg)) return false;
	return bg >= 7;
}

function baseTheme(name: ThemeName, lightBackground: boolean): Theme {
	if (name === "plain") return lightBackground ? PLAIN_LIGHT_THEME : PLAIN_THEME;
	return lightBackground ? CAELENCE_LIGHT_THEME : CAELENCE_THEME;
}

export function resolveTheme(
	theme: ThemeName | Theme | undefined,
	env: Record<string, string | undefined> = process.env,
): Theme {
	const lightBackground = terminalPrefersLightBackground(env);
	if (!theme) return baseTheme("caelence", lightBackground);
	if (typeof theme === "string") return baseTheme(theme, lightBackground);
	const base = baseTheme(theme.name === "plain" ? "plain" : "caelence", lightBackground);
	return { ...base, ...theme };
}
