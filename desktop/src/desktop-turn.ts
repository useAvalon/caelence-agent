import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { PICKS_WHEN_EMPTY, parseSlashLine } from "../../src/cli/slash";
import {
	type AgentEvent,
	type BridgeClient,
	type DesktopState,
	getState,
	isAbortError,
	postSession,
	type SlashOutcome,
	startTurn,
} from "./api";
import type { ComposerAttachment } from "./composer-files";
import { serializeComposerAttachments, toAttachmentPreviews } from "./composer-files";
import type { MainView, PendingApproval, PickerState, ShowNotice, UiStatus } from "./desk-types";
import { desktopCommandView, pickerSelectedId } from "./desk-types";
import { pickerStartIndex } from "./picker-nav";
import type { QueuedMessage } from "./queue";
import {
	applyEvent,
	linesFromTranscript,
	nextUserTurnIndex,
	type StreamLine,
	truncateAfterUserTurn,
} from "./stream";

export function applyDesktopTurnEvent(
	event: AgentEvent,
	setState: Dispatch<SetStateAction<DesktopState | null>>,
	setPending: Dispatch<SetStateAction<PendingApproval | null>>,
	setStatus: Dispatch<SetStateAction<UiStatus>>,
	setLines: Dispatch<SetStateAction<StreamLine[]>>,
): boolean {
	if (event.kind === "session_meta") {
		setState((s) => (s ? { ...s, title: event.title } : s));
	}
	if (event.kind === "approval_request") {
		setPending({
			callId: event.callId,
			toolName: event.toolName,
			input: event.input,
		});
		setStatus("approval");
	}
	setLines((prev) => applyEvent(prev, event));
	return event.kind === "completion" || event.kind === "error";
}

export function failRunningTools(prev: StreamLine[]): StreamLine[] {
	return prev.map((line) =>
		line.type === "tool" && line.status === "running"
			? {
					...line,
					status: "fail" as const,
					error: "Turn stopped before this tool finished.",
				}
			: line,
	);
}

export interface DesktopOutcomeLoop {
	bridge: BridgeClient | null;
	pushSystem: (text: string) => void;
	refreshSessions: (client: BridgeClient) => Promise<void>;
	setState: Dispatch<SetStateAction<DesktopState | null>>;
	setDraft: Dispatch<SetStateAction<string>>;
	setLines: Dispatch<SetStateAction<StreamLine[]>>;
	setPicker: Dispatch<SetStateAction<PickerState | null>>;
	setStatus: Dispatch<SetStateAction<UiStatus>>;
}

export async function applyDesktopOutcome(
	loop: DesktopOutcomeLoop,
	outcome: SlashOutcome,
	nextState?: DesktopState,
): Promise<void> {
	if (nextState) loop.setState(nextState);
	if (outcome.kind === "applied" || outcome.kind === "hold") return;
	if (outcome.kind === "incomplete") {
		loop.setDraft(outcome.draft);
		return;
	}
	if (outcome.kind === "text") {
		loop.pushSystem(outcome.text);
		return;
	}
	if (outcome.kind === "clear") {
		loop.setLines([]);
		loop.pushSystem("New session.");
		if (loop.bridge) await loop.refreshSessions(loop.bridge);
		return;
	}
	if (outcome.kind === "session") {
		if (!loop.bridge) return;
		const loaded = await postSession(loop.bridge, { id: outcome.session.id });
		loop.setState(loaded.state);
		loop.setLines(linesFromTranscript(loaded.messages ?? []));
		loop.pushSystem(`Resumed ${loaded.state.title}`);
		await loop.refreshSessions(loop.bridge);
		return;
	}
	if (outcome.kind === "exit") {
		const { getCurrentWindow } = await import("@tauri-apps/api/window");
		await getCurrentWindow().close();
		return;
	}
	if (outcome.kind === "media") {
		loop.setLines((prev) => [
			...prev,
			{
				key: `media-${prev.length}-${Date.now()}`,
				type: "media",
				kind: outcome.media.kind,
				src: outcome.media.dataUrl,
				caption: outcome.caption,
				mimeType: outcome.media.mimeType,
			},
		]);
		return;
	}
	const currentId = nextState ? pickerSelectedId(outcome.picker, nextState) : undefined;
	loop.setPicker({
		title: outcome.title,
		kind: outcome.picker,
		items: outcome.items,
		index: pickerStartIndex(outcome.items, currentId),
	});
	loop.setStatus("picker");
}

export function isDesktopSlashLine(current: string, edit?: number): boolean {
	if (edit !== undefined) return false;
	return current.startsWith("/") || current === "help" || current === "--help" || current === "-h";
}

export function slashOutcomeStopsLoop(kind: string | undefined): boolean {
	return kind === "picker" || kind === "exit" || kind === "hold" || kind === "incomplete";
}

export interface DesktopTurnLoop {
	bridge: BridgeClient;
	applyOutcome: (outcome: SlashOutcome, next?: DesktopState) => Promise<void> | void;
	noticeError: (err: unknown) => void;
	refreshSessions: (client: BridgeClient) => Promise<void>;
	showNotice: ShowNotice;
	setSkillQuery: Dispatch<SetStateAction<string>>;
	setView: Dispatch<SetStateAction<MainView>>;
	setDraft: Dispatch<SetStateAction<string>>;
	setStatus: Dispatch<SetStateAction<UiStatus>>;
	setLines: Dispatch<SetStateAction<StreamLine[]>>;
	setState: Dispatch<SetStateAction<DesktopState | null>>;
	setPending: Dispatch<SetStateAction<PendingApproval | null>>;
	setQueue: Dispatch<SetStateAction<QueuedMessage[]>>;
	skipDrainRef: MutableRefObject<boolean>;
	queueRef: MutableRefObject<QueuedMessage[]>;
}

export async function runSlashDesktopTurn(
	loop: DesktopTurnLoop,
	current: string,
): Promise<boolean> {
	const { cmd, arg } = parseSlashLine(current);
	const viewForCmd = desktopCommandView(cmd);
	if (viewForCmd) {
		if (viewForCmd === "skills") loop.setSkillQuery(cmd === "skill find" ? arg : "");
		loop.setView(viewForCmd);
		loop.setDraft("");
		return false;
	}
	if (arg || !PICKS_WHEN_EMPTY.has(cmd)) loop.setStatus("running");
	loop.setView("chat");
	try {
		const result = await startTurn(loop.bridge, current);
		if (result?.outcome) await loop.applyOutcome(result.outcome, result.state);
		return !slashOutcomeStopsLoop(result?.outcome?.kind);
	} catch (err) {
		if (!isAbortError(err)) loop.noticeError(err);
		return true;
	}
}

export async function runChatDesktopTurn(
	loop: DesktopTurnLoop,
	current: string,
	edit: number | undefined,
	pendingFiles: ComposerAttachment[],
): Promise<void> {
	loop.setView("chat");
	if (edit !== undefined) {
		loop.setLines((prev) => truncateAfterUserTurn(prev, edit, current));
	} else {
		const previews = toAttachmentPreviews(pendingFiles);
		loop.setLines((prev) => [
			...prev,
			{
				key: `u-${Date.now()}`,
				type: "user",
				text: current,
				userTurnIndex: nextUserTurnIndex(prev),
				...(previews.length > 0 ? { attachments: previews } : {}),
			},
		]);
	}
	loop.setStatus("running");
	try {
		let finished = false;
		const payload =
			pendingFiles.length > 0 ? await serializeComposerAttachments(pendingFiles) : undefined;
		await startTurn(
			loop.bridge,
			current,
			(event: AgentEvent) => {
				if (
					applyDesktopTurnEvent(
						event,
						loop.setState,
						loop.setPending,
						loop.setStatus,
						loop.setLines,
					)
				) {
					finished = true;
				}
			},
			undefined,
			edit,
			payload,
		);
		if (!finished) {
			loop.setLines(failRunningTools);
			loop.showNotice(
				"The turn stopped before the model finished. Send the prompt again.",
				"error",
			);
		}
		const next = await getState(loop.bridge);
		loop.setState(next);
		await loop.refreshSessions(loop.bridge);
	} catch (err) {
		if (!isAbortError(err)) loop.noticeError(err);
	} finally {
		loop.setPending(null);
	}
}

export async function runDesktopTurnLoop(
	loop: DesktopTurnLoop,
	message: string,
	editUserTurn: number | undefined,
	files: ComposerAttachment[],
): Promise<void> {
	let current = message;
	let edit = editUserTurn;
	let pendingFiles = files;
	while (true) {
		if (isDesktopSlashLine(current, edit)) {
			const keepGoing = await runSlashDesktopTurn(loop, current);
			if (!keepGoing) break;
		} else {
			await runChatDesktopTurn(loop, current, edit, pendingFiles);
		}
		if (loop.skipDrainRef.current) break;
		const queued = loop.queueRef.current[0];
		if (!queued) break;
		loop.queueRef.current = loop.queueRef.current.slice(1);
		loop.setQueue(loop.queueRef.current);
		current = queued.text;
		pendingFiles = queued.attachments ?? [];
		edit = undefined;
	}
}
