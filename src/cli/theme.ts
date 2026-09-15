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
	brand: "#9BB35B",
	action: "#9BB35B",
	ink: "#E8E4DC",
	muted: "#9A958C",
	line: "#5C5A55",
	danger: "#E4796E",
	warning: "#D4A054",
	done: "#9BB35B",
};

export const PLAIN_THEME: Theme = {
	name: "plain",
	brand: "green",
	action: "green",
	ink: "white",
	muted: "gray",
	line: "gray",
	danger: "red",
	warning: "yellow",
	done: "green",
};

export function resolveTheme(theme: ThemeName | Theme | undefined): Theme {
	if (!theme) return CAELENCE_THEME;
	if (typeof theme === "string") return theme === "plain" ? PLAIN_THEME : CAELENCE_THEME;
	return { ...CAELENCE_THEME, ...theme };
}
