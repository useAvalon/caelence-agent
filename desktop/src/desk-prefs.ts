import type { ThemeChoice } from "./desk-types";

export function readTheme(): ThemeChoice {
	const value = localStorage.getItem("harness-theme");
	return value === "light" || value === "dark" ? value : "system";
}

export function applyTheme(choice: ThemeChoice): void {
	const root = document.documentElement;
	if (choice === "system") delete root.dataset.theme;
	else root.dataset.theme = choice;
	localStorage.setItem("harness-theme", choice);
}

export function readSidebar(): boolean {
	return localStorage.getItem("harness-sidebar") !== "off";
}

export function writeSidebar(open: boolean): void {
	localStorage.setItem("harness-sidebar", open ? "on" : "off");
}

export function readMediaMeta(): boolean {
	return localStorage.getItem("harness-media-meta") === "on";
}

export function writeMediaMeta(open: boolean): void {
	localStorage.setItem("harness-media-meta", open ? "on" : "off");
}
