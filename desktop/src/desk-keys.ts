import type { Dispatch, SetStateAction } from "react";
import type { SlashCommand } from "./api";
import type { UiStatus } from "./desk-types";

export function slashMenuKey(
	key: string,
	slashOpen: boolean,
	count: number,
): "down" | "up" | "tab" | undefined {
	if (!slashOpen || count === 0) return undefined;
	if (key === "ArrowDown") return "down";
	if (key === "ArrowUp") return "up";
	if (key === "Tab") return "tab";
	return undefined;
}

export function composerEscapeAction(
	editing: boolean,
	status: UiStatus,
): "cancel-edit" | "stop" | undefined {
	if (editing) return "cancel-edit";
	if (status === "running" || status === "approval") return "stop";
	return undefined;
}

export function applySlashComposerKey(
	slashKey: "down" | "up" | "tab" | undefined,
	slashItems: SlashCommand[],
	slashIndex: number,
	setSlashIndex: Dispatch<SetStateAction<number>>,
	setDraft: Dispatch<SetStateAction<string>>,
): boolean {
	if (slashKey === "down") {
		setSlashIndex((index) => (index + 1) % slashItems.length);
		return true;
	}
	if (slashKey === "up") {
		setSlashIndex((index) => (index - 1 + slashItems.length) % slashItems.length);
		return true;
	}
	if (slashKey !== "tab") return false;
	const selected = slashItems[slashIndex] ?? slashItems[0];
	if (selected) setDraft(selected.arg ? `/${selected.name} ` : `/${selected.name}`);
	return true;
}
