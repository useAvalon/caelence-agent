import type { DesktopState, PickerItem, SlashPickerKind } from "./api";
import type { NoticeKind } from "./FloatNotice";

export type { NoticeKind };
export type ShowNotice = (text: string, kind?: NoticeKind) => void;

export type ThemeChoice = "system" | "light" | "dark";
export type UiStatus = "boot" | "idle" | "running" | "approval" | "picker";
export type MainView =
	| "chat"
	| "settings"
	| "integrations"
	| "skills"
	| "files"
	| "memory"
	| "sessions";

export interface PickerState {
	title: string;
	kind: SlashPickerKind;
	items: PickerItem[];
	index: number;
}

export interface SessionMenuState {
	id: string;
	label: string;
	x: number;
	y: number;
}

export interface PendingApproval {
	callId: string;
	toolName: string;
	input: Record<string, unknown>;
}

export interface MediaModelStatus {
	kind: string;
	label: string;
}

export function isUploadEditPending(pending: PendingApproval): boolean {
	return (
		(pending.toolName === "edit_file" || pending.toolName === "write_file") &&
		typeof pending.input.originalPath === "string" &&
		pending.input.originalPath.trim().length > 0
	);
}

export function pickerSelectedId(kind: SlashPickerKind, current: DesktopState): string | undefined {
	if (kind === "model") return current.modelId;
	if (kind === "mode") return current.mode;
	if (kind === "image") return current.imageModelId;
	if (kind === "video") return current.videoModelId;
	if (kind === "transcribe") return current.transcribeModelId;
	return undefined;
}

export function mainViewTitle(view: MainView): string {
	if (view === "settings") return "Settings";
	if (view === "integrations") return "Integrations";
	if (view === "skills") return "Skills";
	if (view === "files") return "Files";
	if (view === "memory") return "Memory";
	if (view === "sessions") return "Sessions";
	return "Chat";
}

export function titleCase(value: string): string {
	return value ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}

export function composerMediaModels(current: DesktopState): MediaModelStatus[] {
	return [
		current.imageModelLabel ? { kind: "Image", label: current.imageModelLabel } : null,
		current.videoModelLabel ? { kind: "Clip", label: current.videoModelLabel } : null,
		current.transcribeModelLabel ? { kind: "Speech", label: current.transcribeModelLabel } : null,
	].filter((part): part is MediaModelStatus => Boolean(part));
}

export function composePlaceholder(listening: boolean, status: UiStatus): string {
	if (listening) return "Listening";
	if (status === "running") return "Queue a follow-up";
	return "Ask the project";
}

export function desktopCommandView(cmd: string): "skills" | "integrations" | undefined {
	if (cmd === "skills" || cmd === "skill find") return "skills";
	if (cmd === "integrations" || cmd === "integration") return "integrations";
	return undefined;
}
