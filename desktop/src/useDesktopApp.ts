import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopState } from "./api";
import { releaseAttachment } from "./composer-files";
import { applySlashComposerKey, composerEscapeAction, slashMenuKey } from "./desk-keys";
import { composerMediaModels } from "./desk-types";
import type { StreamLine } from "./stream";
import { useDeskDictation } from "./useDeskDictation";
import { useDeskFiles } from "./useDeskFiles";
import { useDeskNotice } from "./useDeskNotice";
import { useDeskPicker } from "./useDeskPicker";
import { useDeskPrefs } from "./useDeskPrefs";
import { useDeskRuntime } from "./useDeskRuntime";
import { useDeskSessions } from "./useDeskSessions";
import { useDeskSlash } from "./useDeskSlash";
import { useDeskTurns } from "./useDeskTurns";

export function useDesktopApp() {
	const prefs = useDeskPrefs();
	const notices = useDeskNotice();
	const runtime = useDeskRuntime();
	const viewRef = useRef(runtime.view);
	viewRef.current = runtime.view;
	const transcriptRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const sendingRef = useRef(false);
	const [draft, setDraft] = useState("");
	const [editingUser, setEditingUser] = useState<{
		index: number;
		text: string;
		suffix?: string;
	} | null>(null);

	const files = useDeskFiles({
		view: runtime.view,
		viewRef,
		showNotice: notices.showNotice,
		noticeError: notices.noticeError,
	});

	const dictation = useDeskDictation({
		bridge: runtime.bridge,
		status: runtime.status,
		showNotice: notices.showNotice,
		noticeError: notices.noticeError,
		setDraft,
		inputRef,
	});

	const slashOpen =
		runtime.view === "chat" &&
		draft.startsWith("/") &&
		!dictation.listening &&
		runtime.status !== "picker";
	const slash = useDeskSlash({
		bridge: runtime.bridge,
		draft,
		slashOpen,
	});

	const pushSystem = useCallback(
		(text: string) => {
			runtime.setLines((prev) => [
				...prev,
				{ key: `sys-${prev.length}-${Date.now()}`, type: "system", text },
			]);
		},
		[runtime.setLines],
	);

	const releaseLinePreviews = useCallback(
		(next: StreamLine[]) => {
			runtime.setLines((prev) => {
				for (const line of prev) {
					if (line.type !== "user") continue;
					for (const item of line.attachments ?? []) releaseAttachment(item);
				}
				return next;
			});
		},
		[runtime.setLines],
	);

	const picker = useDeskPicker({
		bridge: runtime.bridge,
		state: runtime.state,
		listening: dictation.listening,
		status: runtime.status,
		sendingRef,
		setState: runtime.setState,
		setStatus: runtime.setStatus,
		setLines: runtime.setLines,
		setDraft,
		pushSystem,
		refreshSessions: runtime.refreshSessions,
		noticeError: notices.noticeError,
		inputRef,
	});

	const turns = useDeskTurns({
		bridge: runtime.bridge,
		status: runtime.status,
		draft,
		listening: dictation.listening,
		slashOpen,
		slashItems: slash.slashItems,
		slashIndex: slash.slashIndex,
		editingUser,
		pending: runtime.pending,
		setState: runtime.setState,
		setStatus: runtime.setStatus,
		setView: runtime.setView,
		setSkillQuery: runtime.setSkillQuery,
		setDraft,
		setLines: runtime.setLines,
		setPending: runtime.setPending,
		setPicker: picker.setPicker,
		setEditingUser,
		pushSystem,
		refreshSessions: runtime.refreshSessions,
		showNotice: notices.showNotice,
		noticeError: notices.noticeError,
		takeAttachments: files.takeAttachments,
		attachmentsRef: files.attachmentsRef,
		sendingRef,
	});

	const sessions = useDeskSessions({
		bridge: runtime.bridge,
		status: runtime.status,
		setState: runtime.setState,
		setView: runtime.setView,
		setEditingUser,
		setQueueSync: turns.setQueueSync,
		releaseLinePreviews,
		noticeError: notices.noticeError,
		refreshSessions: runtime.refreshSessions,
	});

	useEffect(() => {
		const node = transcriptRef.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [runtime.lines, runtime.pending]);

	useEffect(() => () => dictation.stopRecorder(), [dictation.stopRecorder]);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (picker.picker) {
				event.preventDefault();
				return;
			}
			if (event.key === "Escape") {
				const action = composerEscapeAction(Boolean(editingUser), runtime.status);
				if (action === "cancel-edit") {
					event.preventDefault();
					setEditingUser(null);
					return;
				}
				if (action === "stop") {
					event.preventDefault();
					void turns.stop();
					return;
				}
			}
			const slashKey = slashMenuKey(event.key, slashOpen, slash.slashItems.length);
			if (
				applySlashComposerKey(
					slashKey,
					slash.slashItems,
					slash.slashIndex,
					slash.setSlashIndex,
					setDraft,
				)
			) {
				event.preventDefault();
				return;
			}
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				void turns.submit();
			}
		},
		[
			editingUser,
			picker.picker,
			runtime.status,
			slash.slashIndex,
			slash.slashItems,
			slash.setSlashIndex,
			slashOpen,
			turns.stop,
			turns.submit,
		],
	);

	return {
		bootError: runtime.bootError,
		state: runtime.state,
		bridge: runtime.bridge,
		sessions: runtime.sessions,
		lines: runtime.lines,
		draft,
		status: runtime.status,
		view: runtime.view,
		skillQuery: runtime.skillQuery,
		theme: prefs.theme,
		sideOpen: prefs.sideOpen,
		mediaOpen: prefs.mediaOpen,
		slashItems: slash.slashItems,
		slashIndex: slash.slashIndex,
		picker: picker.picker,
		sessionMenu: sessions.sessionMenu,
		renamingId: sessions.renamingId,
		renameDraft: sessions.renameDraft,
		pending: runtime.pending,
		listening: dictation.listening,
		queue: turns.queue,
		editingUser,
		editingQueuedId: turns.editingQueuedId,
		queueOpen: turns.queueOpen,
		notice: notices.notice,
		attachments: files.attachments,
		integrations: runtime.integrations,
		fileDrag: files.fileDrag,
		slashOpen,
		transcriptRef,
		inputRef,
		fileInputRef,
		pickerListRef: picker.pickerListRef,
		sessionMenuRef: sessions.sessionMenuRef,
		renameInputRef: sessions.renameInputRef,
		skipRenameBlurRef: sessions.skipRenameBlurRef,
		mediaModels: runtime.state ? composerMediaModels(runtime.state) : [],
		setState: runtime.setState,
		setStatus: runtime.setStatus,
		setView: runtime.setView,
		setSkillQuery: runtime.setSkillQuery,
		setTheme: prefs.setTheme,
		setSideOpen: prefs.setSideOpen,
		setMediaOpen: prefs.setMediaOpen,
		setSlashIndex: slash.setSlashIndex,
		setDraft,
		setRenamingId: sessions.setRenamingId,
		setRenameDraft: sessions.setRenameDraft,
		setEditingUser,
		setEditingQueuedId: turns.setEditingQueuedId,
		setQueueOpen: turns.setQueueOpen,
		setQueueSync: turns.setQueueSync,
		queueRef: turns.queueRef,
		setSessionMenu: sessions.setSessionMenu,
		setPicker: picker.setPicker,
		dismissNotice: notices.dismissNotice,
		showNotice: notices.showNotice,
		noticeError: notices.noticeError,
		addFiles: files.addFiles,
		removeAttachment: files.removeAttachment,
		onFileDragEnter: files.onFileDragEnter,
		onFileDragOver: files.onFileDragOver,
		onFileDragLeave: files.onFileDragLeave,
		onFileDrop: files.onFileDrop,
		sendTurn: turns.sendTurn,
		openComposerPicker: picker.openComposerPicker,
		submit: turns.submit,
		sendQueuedNow: turns.sendQueuedNow,
		stop: turns.stop,
		commitEdit: turns.commitEdit,
		choosePicker: picker.choosePicker,
		cancelPicker: picker.cancelPicker,
		openSession: sessions.openSession,
		newChat: sessions.newChat,
		commitRename: sessions.commitRename,
		removeChat: sessions.removeChat,
		removeChats: sessions.removeChats,
		decide: turns.decide,
		onKeyDown,
		startDictation: dictation.startDictation,
		stopDictation: dictation.stopDictation,
		applySpoken: dictation.applySpoken,
		ingestDropped: files.ingestDropped,
	};
}

export type DeskReady = Exclude<ReturnType<typeof useDesktopApp>, { state: null }> & {
	state: DesktopState;
};
