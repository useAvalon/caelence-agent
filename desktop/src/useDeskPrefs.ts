import { useEffect, useState } from "react";
import {
	applyTheme,
	readMediaMeta,
	readSidebar,
	readTheme,
	writeMediaMeta,
	writeSidebar,
} from "./desk-prefs";
import type { ThemeChoice } from "./desk-types";

export function useDeskPrefs() {
	const [theme, setTheme] = useState<ThemeChoice>(readTheme);
	const [sideOpen, setSideOpen] = useState(readSidebar);
	const [mediaOpen, setMediaOpen] = useState(readMediaMeta);

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);

	useEffect(() => {
		writeSidebar(sideOpen);
	}, [sideOpen]);

	useEffect(() => {
		writeMediaMeta(mediaOpen);
	}, [mediaOpen]);

	return { theme, setTheme, sideOpen, setSideOpen, mediaOpen, setMediaOpen };
}
