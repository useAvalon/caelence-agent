import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretUp } from "@phosphor-icons/react/dist/csr/CaretUp";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { FolderSimple } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { Gear } from "@phosphor-icons/react/dist/csr/Gear";
import { Microphone } from "@phosphor-icons/react/dist/csr/Microphone";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { Plugs } from "@phosphor-icons/react/dist/csr/Plugs";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { SidebarSimple } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { Square } from "@phosphor-icons/react/dist/csr/Square";
import { Trash } from "@phosphor-icons/react/dist/csr/Trash";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { draftAfterPicker, resolveSlashSubmit } from "../../src/cli/slash";
import {
	type AgentEvent,
	abortTurn,
	approve,
	type BridgeClient,
	connectIntegration,
	type DesktopSettings,
	type DesktopState,
	deleteSession,
	disconnectIntegration,
	embedPreview,
	filesFromDroppedPaths,
	getIntegrations,
	getSessions,
	getSettings,
	getSlash,
	getState,
	isAbortError,
	micStart,
	micStop,
	openExternal,
	openLocalFile,
	type PickerItem,
	type PublicIntegration,
	postPicker,
	postSession,
	renameSession,
	resolveBridge,
	type SlashCommand,
	type SlashOutcome,
	type SlashPickerKind,
	saveSettings,
	startTurn,
	transcribe,
} from "./api";
import { AttachmentThumbs } from "./ComposerAttach";
import {
	type ComposerAttachment,
	droppedPaths,
	filesFromTransfer,
	mergeAttachments,
	releaseAttachment,
	serializeComposerAttachments,
	toAttachmentPreviews,
	transferHasFiles,
} from "./composer-files";
import {
	audioFormatFromMime,
	blobToBase64,
	canUseWebMic,
	dictationErrorMessage,
	isMicPermissionDenied,
	pickRecorderMime,
} from "./dictation";
import { FloatNotice } from "./FloatNotice";
import { integrationMatches } from "./integration-search";
import { LogoMark } from "./LogoMark";
import { pickerKeyAction, pickerStartIndex, stepIndex } from "./picker-nav";
import {
	enqueueMessage,
	type QueuedMessage,
	removeQueued,
	setQueuedText,
	updateQueued,
} from "./queue";
import { canvaViewUrl, splitRichText } from "./rich-text";
import { clampMenuPosition } from "./session-menu";
import {
	applyEvent,
	linesFromTranscript,
	nextUserTurnIndex,
	previewInput,
	type StreamLine,
	truncateAfterUserTurn,
} from "./stream";
import {
	type FoldEntry,
	groupTranscriptLines,
	type ToolLine,
	thoughtSummary,
	thoughtTools,
} from "./thought";
import { eventCountSuffix } from "./tool-label";

type ThemeChoice = "system" | "light" | "dark";
type UiStatus = "boot" | "idle" | "running" | "approval" | "picker";
type MainView = "chat" | "settings" | "integrations";

interface PickerState {
	title: string;
	kind: SlashPickerKind;
	items: PickerItem[];
	index: number;
}

interface SessionMenuState {
	id: string;
	label: string;
	x: number;
	y: number;
}

interface PendingApproval {
	callId: string;
	toolName: string;
	input: Record<string, unknown>;
}

function pickerSelectedId(kind: SlashPickerKind, current: DesktopState): string | undefined {
	if (kind === "model") return current.modelId;
	if (kind === "mode") return current.mode;
	if (kind === "image") return current.imageModelId;
	if (kind === "video") return current.videoModelId;
	if (kind === "transcribe") return current.transcribeModelId;
	return undefined;
}

function titleCase(value: string): string {
	return value ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}

function composerMediaMeta(current: DesktopState): string {
	return [
		current.imageModelLabel ? `Image ${current.imageModelLabel}` : null,
		current.videoModelLabel ? `Clip ${current.videoModelLabel}` : null,
		current.transcribeModelLabel ? `Speech ${current.transcribeModelLabel}` : null,
	]
		.filter((part): part is string => Boolean(part))
		.join(" · ");
}

function readTheme(): ThemeChoice {
	const value = localStorage.getItem("harness-theme");
	return value === "light" || value === "dark" ? value : "system";
}

function applyTheme(choice: ThemeChoice): void {
	const root = document.documentElement;
	if (choice === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", choice);
	localStorage.setItem("harness-theme", choice);
}

function readSidebar(): boolean {
	return localStorage.getItem("harness-sidebar") !== "off";
}

function writeSidebar(open: boolean): void {
	localStorage.setItem("harness-sidebar", open ? "on" : "off");
}

function readMediaMeta(): boolean {
	return localStorage.getItem("harness-media-meta") === "on";
}

function writeMediaMeta(open: boolean): void {
	localStorage.setItem("harness-media-meta", open ? "on" : "off");
}

export function App(): React.ReactElement {
	const [bridge, setBridge] = useState<BridgeClient | null>(null);
	const [bootError, setBootError] = useState<string | null>(null);
	const [state, setState] = useState<DesktopState | null>(null);
	const [sessions, setSessions] = useState<PickerItem[]>([]);
	const [lines, setLines] = useState<StreamLine[]>([]);
	const [draft, setDraft] = useState("");
	const [status, setStatus] = useState<UiStatus>("boot");
	const [view, setView] = useState<MainView>("chat");
	const [theme, setTheme] = useState<ThemeChoice>(readTheme);
	const [sideOpen, setSideOpen] = useState(readSidebar);
	const [mediaOpen, setMediaOpen] = useState(readMediaMeta);
	const [slashItems, setSlashItems] = useState<SlashCommand[]>([]);
	const [slashIndex, setSlashIndex] = useState(0);
	const [picker, setPicker] = useState<PickerState | null>(null);
	const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	const [pending, setPending] = useState<PendingApproval | null>(null);
	const [listening, setListening] = useState(false);
	const [queue, setQueue] = useState<QueuedMessage[]>([]);
	const [editingUser, setEditingUser] = useState<{ index: number; text: string } | null>(null);
	const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
	const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
	const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
	const [fileDrag, setFileDrag] = useState(false);
	const transcriptRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const attachmentsRef = useRef<ComposerAttachment[]>([]);
	const fileDragDepth = useRef(0);
	const viewRef = useRef(view);
	viewRef.current = view;
	const pickerListRef = useRef<HTMLUListElement>(null);
	const sessionMenuRef = useRef<HTMLDivElement>(null);
	const renameInputRef = useRef<HTMLInputElement>(null);
	const skipRenameBlurRef = useRef(false);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const dictationModeRef = useRef<"web" | "native" | null>(null);
	const queueRef = useRef<QueuedMessage[]>([]);
	const sendingRef = useRef(false);
	const skipDrainRef = useRef(false);
	attachmentsRef.current = attachments;

	const slashOpen = view === "chat" && draft.startsWith("/") && !listening && status !== "picker";

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);

	useEffect(() => {
		writeSidebar(sideOpen);
	}, [sideOpen]);

	useEffect(() => {
		writeMediaMeta(mediaOpen);
	}, [mediaOpen]);

	const refreshSessions = useCallback(async (client: BridgeClient) => {
		const result = await getSessions(client);
		setSessions(result.items);
	}, []);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const client = await resolveBridge();
				const next = await getState(client);
				const listed = await getSessions(client);
				if (cancelled) return;
				setBridge(client);
				setState(next);
				setSessions(listed.items);
				if (next.sessionId) {
					const loaded = await postSession(client, { id: next.sessionId });
					if (cancelled) return;
					setState(loaded.state);
					setLines(linesFromTranscript(loaded.messages ?? []));
				}
				setStatus("idle");
			} catch (err) {
				if (cancelled) return;
				setBootError(
					err instanceof Error ? err.message : "Caelence agent could not reach the local runtime.",
				);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		const node = transcriptRef.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [lines, pending]);

	useEffect(() => {
		if (!bridge || !slashOpen) {
			setSlashItems([]);
			return;
		}
		let cancelled = false;
		void getSlash(bridge, draft).then((result) => {
			if (!cancelled) setSlashItems(result.items);
		});
		return () => {
			cancelled = true;
		};
	}, [bridge, draft, slashOpen]);

	useEffect(() => {
		setSlashIndex(0);
	}, [draft]);

	const pushSystem = useCallback((text: string) => {
		setLines((prev) => [
			...prev,
			{ key: `sys-${prev.length}-${Date.now()}`, type: "system", text },
		]);
	}, []);

	const dismissNotice = useCallback(() => setNotice(null), []);

	const showNotice = useCallback((text: string) => {
		const line = text.trim();
		if (!line) return;
		setNotice({ text: line, id: Date.now() });
	}, []);

	const noticeError = useCallback(
		(err: unknown) => {
			showNotice(err instanceof Error ? err.message : String(err));
		},
		[showNotice],
	);

	const applyOutcome = useCallback(
		async (outcome: SlashOutcome, nextState?: DesktopState) => {
			if (nextState) setState(nextState);
			if (outcome.kind === "applied" || outcome.kind === "hold") return;
			if (outcome.kind === "incomplete") {
				setDraft(outcome.draft);
				return;
			}
			if (outcome.kind === "text") {
				pushSystem(outcome.text);
				return;
			}
			if (outcome.kind === "clear") {
				setLines([]);
				pushSystem("New session.");
				if (bridge) await refreshSessions(bridge);
				return;
			}
			if (outcome.kind === "session") {
				if (!bridge) return;
				const loaded = await postSession(bridge, { id: outcome.session.id });
				setState(loaded.state);
				setLines(linesFromTranscript(loaded.messages ?? []));
				pushSystem(`Resumed ${loaded.state.title}`);
				await refreshSessions(bridge);
				return;
			}
			if (outcome.kind === "exit") {
				const { getCurrentWindow } = await import("@tauri-apps/api/window");
				await getCurrentWindow().close();
				return;
			}
			if (outcome.kind === "media") {
				setLines((prev) => [
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
			setPicker({
				title: outcome.title,
				kind: outcome.picker,
				items: outcome.items,
				index: pickerStartIndex(outcome.items, currentId),
			});
			setStatus("picker");
		},
		[bridge, pushSystem, refreshSessions],
	);

	const setQueueSync = useCallback((next: QueuedMessage[]) => {
		queueRef.current = next;
		setQueue(next);
	}, []);

	const addFiles = useCallback(
		(files: File[]) => {
			if (files.length === 0) return;
			const next = mergeAttachments(attachmentsRef.current, files);
			if (next.rejected.length > 0) {
				showNotice(`Could not add ${next.rejected.join(", ")}.`);
			}
			if (next.attachments === attachmentsRef.current) return;
			attachmentsRef.current = next.attachments;
			setAttachments(next.attachments);
		},
		[showNotice],
	);

	const ingestDropped = useCallback(
		async (transfer: DataTransfer | null, extraPaths: string[] = []) => {
			if (viewRef.current !== "chat") return;
			const html = filesFromTransfer(transfer);
			const usable = html.filter((file) => file.size > 0);
			if (usable.length > 0) {
				addFiles(usable);
				return;
			}
			const paths = [...new Set([...extraPaths, ...droppedPaths(transfer)])];
			if (paths.length === 0) {
				if (html.length > 0) addFiles(html);
				return;
			}
			try {
				const files = await filesFromDroppedPaths(paths);
				addFiles(files.length > 0 ? files : html);
			} catch (err) {
				noticeError(err);
			}
		},
		[addFiles, noticeError],
	);

	const takeAttachments = useCallback((): ComposerAttachment[] => {
		const items = attachmentsRef.current;
		attachmentsRef.current = [];
		setAttachments([]);
		return items;
	}, []);

	const removeAttachment = useCallback((index: number) => {
		setAttachments((current) => {
			const item = current[index];
			if (item) releaseAttachment(item);
			return current.filter((_, at) => at !== index);
		});
	}, []);

	const onFileDragEnter = useCallback(
		(event: React.DragEvent) => {
			if (view !== "chat" || !transferHasFiles(event.dataTransfer)) return;
			event.preventDefault();
			fileDragDepth.current += 1;
			setFileDrag(true);
		},
		[view],
	);

	const onFileDragOver = useCallback((event: React.DragEvent) => {
		if (!transferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}, []);

	const onFileDragLeave = useCallback((event: React.DragEvent) => {
		if (!transferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
		if (fileDragDepth.current === 0) setFileDrag(false);
	}, []);

	const onFileDrop = useCallback(
		(event: React.DragEvent) => {
			if (view !== "chat" || !transferHasFiles(event.dataTransfer)) return;
			event.preventDefault();
			event.stopPropagation();
			fileDragDepth.current = 0;
			setFileDrag(false);
			void ingestDropped(event.dataTransfer);
		},
		[ingestDropped, view],
	);

	const sendTurn = useCallback(
		async (message: string, editUserTurn?: number, files: ComposerAttachment[] = []) => {
			if (!bridge) return;
			sendingRef.current = true;
			skipDrainRef.current = false;
			setView("chat");
			try {
				let current = message;
				let edit = editUserTurn;
				let pendingFiles = files;
				while (true) {
					const slash =
						edit === undefined &&
						(current.startsWith("/") ||
							current === "help" ||
							current === "--help" ||
							current === "-h");
					if (slash) {
						setStatus("running");
						try {
							const result = await startTurn(bridge, current);
							if (result?.outcome) await applyOutcome(result.outcome, result.state);
							if (
								result?.outcome?.kind === "picker" ||
								result?.outcome?.kind === "exit" ||
								result?.outcome?.kind === "hold" ||
								result?.outcome?.kind === "incomplete"
							) {
								break;
							}
						} catch (err) {
							if (!isAbortError(err)) noticeError(err);
						}
					} else {
						const editIndex = edit;
						const previews = toAttachmentPreviews(pendingFiles);
						if (editIndex !== undefined) {
							setLines((prev) => truncateAfterUserTurn(prev, editIndex, current));
						} else {
							setLines((prev) => [
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
						setStatus("running");
						try {
							let finished = false;
							const payload =
								pendingFiles.length > 0
									? await serializeComposerAttachments(pendingFiles)
									: undefined;
							await startTurn(
								bridge,
								current,
								(event: AgentEvent) => {
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
									if (event.kind === "completion" || event.kind === "error") finished = true;
									setLines((prev) => applyEvent(prev, event));
								},
								undefined,
								edit,
								payload,
							);
							if (!finished) {
								setLines((prev) =>
									prev.map((line) =>
										line.type === "tool" && line.status === "running"
											? {
													...line,
													status: "fail" as const,
													error: "Turn stopped before this tool finished.",
												}
											: line,
									),
								);
								showNotice("The turn stopped before the model finished. Send the prompt again.");
							}
							const next = await getState(bridge);
							setState(next);
							await refreshSessions(bridge);
						} catch (err) {
							if (!isAbortError(err)) noticeError(err);
						} finally {
							setPending(null);
						}
					}
					if (skipDrainRef.current) break;
					const queued = queueRef.current[0];
					if (!queued) break;
					queueRef.current = queueRef.current.slice(1);
					setQueue(queueRef.current);
					current = queued.text;
					pendingFiles = queued.attachments ?? [];
					edit = undefined;
				}
			} finally {
				sendingRef.current = false;
				setPending(null);
				setStatus((current) => (current === "picker" ? current : "idle"));
			}
		},
		[applyOutcome, bridge, noticeError, refreshSessions, showNotice],
	);

	const openComposerPicker = useCallback(
		async (kind: "model" | "mode") => {
			if (
				!bridge ||
				listening ||
				status === "boot" ||
				status === "running" ||
				status === "approval"
			) {
				return;
			}
			if (sendingRef.current) return;
			await sendTurn(`/${kind}`);
		},
		[bridge, listening, sendTurn, status],
	);

	const submit = useCallback(async () => {
		if (!bridge || listening || status === "picker" || status === "boot") return;
		const message = draft.trim();
		const files = attachmentsRef.current;
		if (!message && files.length === 0) return;
		const slash = message ? resolveSlashSubmit(message) : undefined;
		if (slash?.action === "hold") return;
		if (slash?.action === "complete") {
			setDraft(slash.line);
			return;
		}
		const toSend = slash?.action === "send" ? slash.line : message;
		const pendingFiles = slash ? [] : takeAttachments();
		setDraft("");
		setView("chat");
		if (status === "running" || status === "approval" || sendingRef.current) {
			setQueueSync(enqueueMessage(queueRef.current, toSend, `q-${Date.now()}`, pendingFiles));
			return;
		}
		await sendTurn(toSend, undefined, pendingFiles);
	}, [bridge, draft, listening, sendTurn, setQueueSync, status, takeAttachments]);

	const stop = useCallback(async () => {
		if (!bridge) return;
		await abortTurn(bridge);
	}, [bridge]);

	const commitEdit = useCallback(async () => {
		if (!bridge || !editingUser) return;
		const text = editingUser.text.trim();
		if (!text) return;
		const index = editingUser.index;
		setEditingUser(null);
		skipDrainRef.current = true;
		if (status === "running" || status === "approval" || sendingRef.current) {
			await abortTurn(bridge);
			for (let i = 0; i < 50 && sendingRef.current; i++) {
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
		}
		skipDrainRef.current = false;
		await sendTurn(text, index);
	}, [bridge, editingUser, sendTurn, status]);

	const choosePicker = useCallback(
		async (item: PickerItem) => {
			if (!bridge || !picker) return;
			const kind = picker.kind;
			setPicker(null);
			setStatus("idle");
			const result = await postPicker(bridge, kind, item.id);
			setState(result.state);
			if (result.messages) {
				setLines(linesFromTranscript(result.messages));
				pushSystem(`Resumed ${result.state.title}`);
			} else if (result.text) {
				pushSystem(result.text);
			}
			const nextDraft = draftAfterPicker(kind);
			if (nextDraft) {
				setDraft(nextDraft);
				requestAnimationFrame(() => inputRef.current?.focus());
			}
			await refreshSessions(bridge);
		},
		[bridge, picker, pushSystem, refreshSessions],
	);

	const cancelPicker = useCallback(() => {
		if (!picker) return;
		const next = draftAfterPicker(picker.kind);
		setPicker(null);
		setStatus("idle");
		if (next) setDraft(next);
		requestAnimationFrame(() => inputRef.current?.focus());
	}, [picker]);

	useEffect(() => {
		if (!picker) return;
		const onKey = (event: KeyboardEvent) => {
			const action = pickerKeyAction(event.key, event.shiftKey);
			if (!action) return;
			event.preventDefault();
			event.stopPropagation();
			if (action.type === "move") {
				setPicker((current) =>
					current
						? { ...current, index: stepIndex(current.index, current.items.length, action.delta) }
						: current,
				);
				return;
			}
			if (action.type === "confirm") {
				const item = picker.items[picker.index];
				if (item) void choosePicker(item);
				return;
			}
			if (action.type === "cancel") cancelPicker();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [cancelPicker, choosePicker, picker]);

	useEffect(() => {
		if (!picker) return;
		const node = pickerListRef.current?.querySelector(`[data-picker-index="${picker.index}"]`);
		if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" });
	}, [picker]);

	const releaseLinePreviews = useCallback((next: StreamLine[]) => {
		setLines((prev) => {
			for (const line of prev) {
				if (line.type !== "user") continue;
				for (const item of line.attachments ?? []) releaseAttachment(item);
			}
			return next;
		});
	}, []);

	const openSession = useCallback(
		async (id: string) => {
			if (!bridge || status !== "idle") return;
			setView("chat");
			setQueueSync([]);
			setEditingUser(null);
			setRenamingId(null);
			setSessionMenu(null);
			const loaded = await postSession(bridge, { id });
			setState(loaded.state);
			releaseLinePreviews(linesFromTranscript(loaded.messages ?? []));
		},
		[bridge, releaseLinePreviews, setQueueSync, status],
	);

	const newChat = useCallback(async () => {
		if (!bridge || status !== "idle") return;
		setView("chat");
		setQueueSync([]);
		setEditingUser(null);
		setRenamingId(null);
		setSessionMenu(null);
		const next = await postSession(bridge, { clear: true });
		setState(next.state);
		releaseLinePreviews([]);
	}, [bridge, releaseLinePreviews, setQueueSync, status]);

	const commitRename = useCallback(async () => {
		if (!bridge || !renamingId) return;
		const id = renamingId;
		const nextTitle = renameDraft.trim();
		setRenamingId(null);
		if (!nextTitle) return;
		try {
			const result = await renameSession(bridge, id, nextTitle);
			setState(result.state);
			await refreshSessions(bridge);
		} catch (err) {
			noticeError(err);
		}
	}, [bridge, noticeError, refreshSessions, renameDraft, renamingId]);

	const removeChat = useCallback(
		async (id: string) => {
			if (!bridge) return;
			setSessionMenu(null);
			try {
				const result = await deleteSession(bridge, id);
				setState(result.state);
				if (result.cleared) {
					releaseLinePreviews([]);
					setQueueSync([]);
					setEditingUser(null);
				}
				await refreshSessions(bridge);
			} catch (err) {
				noticeError(err);
			}
		},
		[bridge, noticeError, refreshSessions, releaseLinePreviews, setQueueSync],
	);

	useLayoutEffect(() => {
		if (!sessionMenu) return;
		const node = sessionMenuRef.current;
		if (!node) return;
		const next = clampMenuPosition(
			sessionMenu.x,
			sessionMenu.y,
			{ width: node.offsetWidth, height: node.offsetHeight },
			{ width: window.innerWidth, height: window.innerHeight },
		);
		node.style.left = `${next.x}px`;
		node.style.top = `${next.y}px`;
		node.querySelector("button")?.focus();
	}, [sessionMenu]);

	useEffect(() => {
		if (!sessionMenu) return;
		const onPointer = (event: Event) => {
			const node = event.target;
			if (node instanceof Node && sessionMenuRef.current?.contains(node)) return;
			setSessionMenu(null);
		};
		window.addEventListener("mousedown", onPointer);
		return () => window.removeEventListener("mousedown", onPointer);
	}, [sessionMenu]);

	useEffect(() => {
		if (renamingId) renameInputRef.current?.focus();
	}, [renamingId]);

	useEffect(() => {
		if (!sessionMenu && !renamingId) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setSessionMenu(null);
			if (renamingId) {
				skipRenameBlurRef.current = true;
				setRenamingId(null);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [renamingId, sessionMenu]);

	const decide = useCallback(
		async (decision: "yes" | "no" | "always") => {
			if (!bridge || !pending) return;
			await approve(bridge, {
				callId: pending.callId,
				decision,
				toolName: pending.toolName,
			});
			setPending(null);
			setStatus("running");
		},
		[bridge, pending],
	);

	const applySpoken = useCallback(
		async (data: string, format: string) => {
			if (!bridge) return;
			try {
				const result = await transcribe(bridge, { data, format });
				const spoken = result.text.trim();
				if (!spoken) {
					showNotice("Transcription returned no text.");
					return;
				}
				setDraft((current) => (current.trim() ? `${current.trim()} ${spoken}` : spoken));
				inputRef.current?.focus();
			} catch (err) {
				noticeError(err);
			}
		},
		[bridge, noticeError, showNotice],
	);

	const stopDictation = useCallback(() => {
		const mode = dictationModeRef.current;
		if (mode === "native") {
			dictationModeRef.current = null;
			setListening(false);
			void (async () => {
				try {
					const clip = await micStop();
					await applySpoken(clip.data, clip.format);
				} catch (err) {
					noticeError(err);
				}
			})();
			return;
		}
		const recorder = recorderRef.current;
		if (!recorder) {
			setListening(false);
			return;
		}
		if (recorder.state !== "inactive") recorder.stop();
	}, [applySpoken, noticeError]);

	const startDictation = useCallback(async () => {
		if (!bridge || status !== "idle" || listening) return;
		const startWeb = async () => {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const mime = pickRecorderMime();
			const recorder = mime
				? new MediaRecorder(stream, { mimeType: mime })
				: new MediaRecorder(stream);
			const chunks: Blob[] = [];
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) chunks.push(event.data);
			};
			recorder.onstop = () => {
				for (const track of stream.getTracks()) track.stop();
				recorderRef.current = null;
				dictationModeRef.current = null;
				setListening(false);
				const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
				if (blob.size === 0) return;
				void blobToBase64(blob).then((data) => applySpoken(data, audioFormatFromMime(blob.type)));
			};
			recorderRef.current = recorder;
			dictationModeRef.current = "web";
			recorder.start(250);
			setListening(true);
		};
		if (canUseWebMic()) {
			try {
				await startWeb();
				return;
			} catch (err) {
				if (isMicPermissionDenied(err)) {
					showNotice(dictationErrorMessage(err));
					return;
				}
			}
		}
		try {
			await micStart();
			dictationModeRef.current = "native";
			setListening(true);
		} catch (err) {
			showNotice(dictationErrorMessage(err));
		}
	}, [applySpoken, bridge, listening, showNotice, status]);

	useEffect(() => {
		const onOver = (event: DragEvent) => {
			if (!transferHasFiles(event.dataTransfer)) return;
			event.preventDefault();
		};
		const onDrop = (event: DragEvent) => {
			if (!transferHasFiles(event.dataTransfer)) return;
			event.preventDefault();
			fileDragDepth.current = 0;
			setFileDrag(false);
			void ingestDropped(event.dataTransfer);
		};
		window.addEventListener("dragover", onOver);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragover", onOver);
			window.removeEventListener("drop", onDrop);
			const recorder = recorderRef.current;
			if (recorder && recorder.state !== "inactive") recorder.stop();
			if (dictationModeRef.current === "native") {
				void micStop().catch(() => undefined);
				dictationModeRef.current = null;
			}
			for (const item of attachmentsRef.current) releaseAttachment(item);
		};
	}, [ingestDropped]);

	useEffect(() => {
		let cancelled = false;
		let stop: (() => void) | undefined;
		void (async () => {
			try {
				const { getCurrentWebview } = await import("@tauri-apps/api/webview");
				const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
					if (viewRef.current !== "chat") return;
					if (event.payload.type === "enter" || event.payload.type === "over") {
						setFileDrag(true);
						return;
					}
					if (event.payload.type === "leave") {
						setFileDrag(false);
						return;
					}
					if (event.payload.type === "drop") {
						setFileDrag(false);
						void ingestDropped(null, event.payload.paths);
					}
				});
				if (cancelled) unlisten();
				else stop = unlisten;
			} catch {
				// Browser preview has no Tauri webview.
			}
		})();
		return () => {
			cancelled = true;
			stop?.();
		};
	}, [ingestDropped]);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (picker) {
				event.preventDefault();
				return;
			}
			if (event.key === "Escape") {
				if (editingUser) {
					event.preventDefault();
					setEditingUser(null);
					return;
				}
				if (status === "running" || status === "approval") {
					event.preventDefault();
					void stop();
					return;
				}
			}
			if (slashOpen && slashItems.length > 0) {
				if (event.key === "ArrowDown") {
					event.preventDefault();
					setSlashIndex((index) => (index + 1) % slashItems.length);
					return;
				}
				if (event.key === "ArrowUp") {
					event.preventDefault();
					setSlashIndex((index) => (index - 1 + slashItems.length) % slashItems.length);
					return;
				}
				if (event.key === "Tab") {
					event.preventDefault();
					const selected = slashItems[slashIndex] ?? slashItems[0];
					if (selected) setDraft(selected.arg ? `/${selected.name} ` : `/${selected.name}`);
					return;
				}
			}
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				void submit();
			}
		},
		[editingUser, picker, slashIndex, slashItems, slashOpen, status, stop, submit],
	);

	const mediaMeta = state ? composerMediaMeta(state) : "";

	if (bootError) {
		return (
			<div className="desk desk--boot">
				<header className="desk-bar">
					<LogoMark size={20} />
					<h1>Caelence</h1>
				</header>
				<main className="desk-empty">
					<p>{bootError}</p>
					<p>Open this UI from the Caelence agent window, not a browser tab.</p>
				</main>
			</div>
		);
	}

	if (!state) {
		return (
			<div className="desk desk--boot">
				<header className="desk-bar">
					<LogoMark size={20} />
					<h1>Caelence</h1>
					<span className="cel-chip cel-chip--run">
						<span className="cel-chip__spin" aria-hidden="true" />
						Starting
					</span>
				</header>
			</div>
		);
	}

	const approvalPreview = pending ? previewInput(pending.input) : "";
	const turnRunning = status === "running" || status === "approval";
	const transcriptBlocks = groupTranscriptLines(lines);
	const lastLine = lines.at(-1);
	const thoughtPending = turnRunning && (!lastLine || lastLine.type === "user");
	const warmupSeed = lastLine?.type === "user" ? lastLine.userTurnIndex : 0;

	return (
		<div className={`desk${sideOpen ? "" : " is-side-off"}`}>
			<aside className="desk-side">
				<div className="desk-brand">
					<LogoMark size={20} />
					<div className="desk-brand-copy">
						<p className="desk-wordmark">Caelence</p>
						<p className="desk-product">agent</p>
					</div>
					<button
						type="button"
						className="desk-side-toggle"
						aria-pressed={sideOpen}
						aria-label={sideOpen ? "Hide sidebar" : "Show sidebar"}
						onClick={() => setSideOpen((open) => !open)}
					>
						<SidebarSimple size={16} weight="regular" />
					</button>
				</div>
				<button
					type="button"
					className="desk-settings-btn desk-new"
					disabled={status !== "idle"}
					aria-label="New chat"
					onClick={() => void newChat()}
				>
					<Plus size={16} weight="regular" />
					<span>New chat</span>
				</button>
				<section className="desk-sessions" aria-label="Sessions">
					<h2>Sessions</h2>
					{sessions.length === 0 ? (
						<p className="desk-side-empty">No saved sessions</p>
					) : (
						<ul>
							{sessions.map((item) => (
								<li
									key={item.id}
									onContextMenu={(event) => {
										event.preventDefault();
										setPicker(null);
										setStatus((current) => (current === "picker" ? "idle" : current));
										setRenamingId(null);
										setSessionMenu({
											id: item.id,
											label: item.label,
											x: event.clientX,
											y: event.clientY,
										});
									}}
								>
									{renamingId === item.id ? (
										<input
											ref={renameInputRef}
											className="cel-input desk-rename"
											value={renameDraft}
											aria-label="Chat name"
											onChange={(event) => setRenameDraft(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													event.stopPropagation();
													skipRenameBlurRef.current = true;
													void commitRename();
												}
												if (event.key === "Escape") {
													event.preventDefault();
													event.stopPropagation();
													skipRenameBlurRef.current = true;
													setRenamingId(null);
												}
											}}
											onBlur={() => {
												if (skipRenameBlurRef.current) {
													skipRenameBlurRef.current = false;
													return;
												}
												void commitRename();
											}}
										/>
									) : (
										<button
											type="button"
											className={item.id === state.sessionId ? "is-on" : undefined}
											disabled={status !== "idle"}
											onClick={() => void openSession(item.id)}
										>
											<span>{item.label}</span>
											{item.hint ? <em>{item.hint}</em> : null}
										</button>
									)}
								</li>
							))}
						</ul>
					)}
				</section>
				<button
					type="button"
					className={`desk-settings-btn ${view === "integrations" ? "is-on" : ""}`}
					aria-label="Integrations"
					onClick={() =>
						setView((current) => (current === "integrations" ? "chat" : "integrations"))
					}
				>
					<Plugs size={16} weight="regular" />
					<span>Integrations</span>
				</button>
				<button
					type="button"
					className={`desk-settings-btn ${view === "settings" ? "is-on" : ""}`}
					aria-label="Settings"
					onClick={() => setView((current) => (current === "settings" ? "chat" : "settings"))}
				>
					<Gear size={16} weight="regular" />
					<span>Settings</span>
				</button>
			</aside>

			<section
				className={`desk-main${fileDrag && view === "chat" ? " is-file-drag" : ""}`}
				aria-label="Chat"
				onDragEnter={onFileDragEnter}
				onDragOver={onFileDragOver}
				onDragLeave={onFileDragLeave}
				onDrop={onFileDrop}
			>
				<header className="desk-bar">
					<div className="desk-id">
						<h1>
							{view === "settings" ? "Settings" : view === "integrations" ? "Integrations" : "Chat"}
						</h1>
						{view === "chat" && state.spend ? <p>{state.spend}</p> : null}
					</div>
				</header>

				{view === "settings" && bridge ? (
					<SettingsPanel
						bridge={bridge}
						theme={theme}
						onTheme={setTheme}
						onSaved={(next) => setState(next)}
						onNotice={showNotice}
					/>
				) : view === "integrations" && bridge ? (
					<IntegrationsPanel bridge={bridge} onNotice={showNotice} />
				) : (
					<div className="desk-transcript" ref={transcriptRef}>
						{lines.length === 0 && !thoughtPending ? (
							<p className="desk-hint">Type a message, drop files, or / for commands</p>
						) : (
							<>
								{transcriptBlocks.map((block, index) => {
									if (block.type === "thought") {
										const tools = thoughtTools(block.entries);
										return (
											<ThoughtFold
												key={tools[0]?.key ?? `thought-${index}`}
												entries={block.entries}
												live={turnRunning && block.live}
											/>
										);
									}
									const line = block.line;
									return (
										<TranscriptLine
											key={line.key}
											line={line}
											bridge={bridge}
											editing={
												line.type === "user" && editingUser?.index === line.userTurnIndex
													? editingUser.text
													: null
											}
											onStartEdit={
												line.type === "user"
													? () => setEditingUser({ index: line.userTurnIndex, text: line.text })
													: undefined
											}
											onEditChange={(text) =>
												setEditingUser((current) => (current ? { ...current, text } : current))
											}
											onEditSave={() => void commitEdit()}
											onEditCancel={() => setEditingUser(null)}
											onOpenUrl={(url) => {
												void openExternal(url, bridge).catch((err: unknown) => {
													noticeError(err);
												});
											}}
											onOpenFile={(path, reveal) => {
												void openLocalFile(path, reveal, bridge).catch((err: unknown) => {
													noticeError(err);
												});
											}}
										/>
									);
								})}
								{thoughtPending ? (
									<ThoughtFold key="thinking" entries={[]} live warmupSeed={warmupSeed} />
								) : null}
							</>
						)}
					</div>
				)}

				{view === "chat" && pending ? (
					<section className="desk-approve" aria-label="Approval needed">
						<p>Approval needed · {pending.toolName}</p>
						<pre className="cel-code">{approvalPreview}</pre>
						<div className="desk-approve-actions">
							<button
								type="button"
								className="cel-btn cel-btn--secondary cel-btn--compact"
								onClick={() => void decide("yes")}
							>
								Approve
							</button>
							<button
								type="button"
								className="cel-btn cel-btn--secondary cel-btn--compact"
								onClick={() => void decide("no")}
							>
								Deny
							</button>
							<button
								type="button"
								className="cel-btn cel-btn--tertiary cel-btn--compact"
								onClick={() => void decide("always")}
							>
								Always this session
							</button>
						</div>
					</section>
				) : null}

				{view === "chat" ? (
					<footer className="desk-composer">
						{fileDrag ? <p className="desk-composer__drop">Drop files to attach</p> : null}
						{view === "chat" && mediaMeta ? (
							<div className={`desk-composer__meta${mediaOpen ? "" : " is-min"}`}>
								{mediaOpen ? <p>{mediaMeta}</p> : null}
								<button
									type="button"
									className="desk-composer__meta-toggle"
									aria-expanded={mediaOpen}
									aria-label={mediaOpen ? "Hide media models" : "Show media models"}
									onClick={() => setMediaOpen((open) => !open)}
								>
									{mediaOpen ? (
										<CaretUp size={14} weight="bold" />
									) : (
										<CaretDown size={14} weight="bold" />
									)}
								</button>
							</div>
						) : null}
						{queue.length > 0 ? (
							<ul className="desk-queue" aria-label="Queued messages">
								{queue.map((item) => (
									<li key={item.id} className="desk-queue-item">
										{editingQueuedId === item.id ? (
											<textarea
												className="cel-input desk-compose-input"
												rows={2}
												value={item.text}
												aria-label="Edit queued message"
												onChange={(event) =>
													setQueueSync(setQueuedText(queueRef.current, item.id, event.target.value))
												}
												onKeyDown={(event) => {
													if (event.key === "Enter" && !event.shiftKey) {
														event.preventDefault();
														setQueueSync(updateQueued(queueRef.current, item.id, item.text));
														setEditingQueuedId(null);
													}
													if (event.key === "Escape") {
														event.preventDefault();
														setEditingQueuedId(null);
													}
												}}
												onBlur={() => {
													setQueueSync(updateQueued(queueRef.current, item.id, item.text));
													setEditingQueuedId(null);
												}}
											/>
										) : (
											<div className="desk-queue-copy">
												<AttachmentThumbs items={item.attachments ?? []} />
												{item.text ? (
													<button
														type="button"
														className="desk-queue-text"
														onClick={() => setEditingQueuedId(item.id)}
													>
														{item.text}
													</button>
												) : null}
											</div>
										)}
										<button
											type="button"
											className="cel-btn cel-btn--quiet cel-btn--compact"
											aria-label="Remove from queue"
											onClick={() => {
												if (editingQueuedId === item.id) setEditingQueuedId(null);
												setQueueSync(removeQueued(queueRef.current, item.id));
											}}
										>
											<X size={16} weight="regular" />
										</button>
									</li>
								))}
							</ul>
						) : null}
						<div className="desk-composer__row">
							<input
								ref={fileInputRef}
								className="visually-hidden"
								type="file"
								multiple
								onChange={(event) => {
									addFiles(Array.from(event.target.files ?? []));
									event.target.value = "";
								}}
							/>
							<fieldset
								className={`desk-field desk-compose-box${attachments.length > 0 ? " has-files" : ""}`}
								onDragEnter={onFileDragEnter}
								onDragOver={onFileDragOver}
								onDragLeave={onFileDragLeave}
								onDrop={onFileDrop}
							>
								<legend className="visually-hidden">Message composer</legend>
								{slashOpen && slashItems.length > 0 ? (
									<div className="desk-slash cel-float">
										{slashItems.map((item, index) => (
											<button
												key={item.name}
												type="button"
												className={index === slashIndex ? "is-on" : undefined}
												onClick={() => setDraft(item.arg ? `/${item.name} ` : `/${item.name}`)}
											>
												<span>
													/{item.name}
													{item.slot ? ` ${item.slot}` : ""}
												</span>
												<em>· {item.hint}</em>
											</button>
										))}
									</div>
								) : null}
								{picker ? (
									<div className="desk-float cel-float" role="listbox" aria-label={picker.title}>
										<p>{picker.title}</p>
										<ul ref={pickerListRef}>
											{picker.items.map((item, index) => {
												const applied = state && item.id === pickerSelectedId(picker.kind, state);
												return (
													<li key={item.id}>
														<button
															type="button"
															role="option"
															aria-selected={index === picker.index}
															data-picker-index={index}
															className={index === picker.index ? "is-on" : undefined}
															onClick={() => void choosePicker(item)}
														>
															<span>{item.label}</span>
															{applied ? <em>on</em> : item.hint ? <em>{item.hint}</em> : null}
														</button>
													</li>
												);
											})}
										</ul>
										<button
											type="button"
											className="cel-btn cel-btn--quiet cel-btn--compact"
											onClick={() => cancelPicker()}
										>
											Cancel
										</button>
									</div>
								) : null}
								<AttachmentThumbs items={attachments} onRemove={removeAttachment} />
								<textarea
									ref={inputRef}
									className="cel-input desk-compose-input"
									rows={1}
									aria-label="Message"
									value={draft}
									placeholder={
										listening
											? "Listening"
											: status === "running"
												? "Queue a follow-up"
												: "Ask the project"
									}
									disabled={listening}
									onChange={(event) => setDraft(event.target.value)}
									onKeyDown={onKeyDown}
								/>
								<div className="desk-compose-bar">
									<button
										type="button"
										className="desk-compose-icon"
										aria-label="Add files"
										onClick={() => fileInputRef.current?.click()}
									>
										<Plus size={16} weight="regular" />
									</button>
									<div className="desk-compose-bar__end">
										<button
											type="button"
											className="desk-compose-model"
											aria-label="Choose model"
											disabled={status !== "idle" && status !== "picker"}
											onClick={() => void openComposerPicker("model")}
										>
											<span>{state.modelTarget ?? state.modelLabel}</span>
											<CaretDown size={12} weight="bold" />
										</button>
										<button
											type="button"
											className="desk-compose-mode"
											aria-label="Choose mode"
											disabled={status !== "idle" && status !== "picker"}
											onClick={() => void openComposerPicker("mode")}
										>
											<span className="desk-compose-mode__dot" aria-hidden="true" />
											{titleCase(state.mode)}
										</button>
										{status === "running" || status === "approval" ? (
											<button
												type="button"
												className="desk-compose-icon"
												aria-label="Stop"
												onClick={() => void stop()}
											>
												<Square size={16} weight="regular" />
											</button>
										) : listening ? (
											<button
												type="button"
												className="desk-compose-icon is-on"
												aria-label="Stop dictation"
												aria-pressed
												onClick={() => stopDictation()}
											>
												<Microphone size={16} weight="regular" />
											</button>
										) : (
											<button
												type="button"
												className="desk-compose-icon"
												aria-label="Dictate"
												aria-pressed={false}
												disabled={status !== "idle"}
												onClick={() => void startDictation()}
											>
												<Microphone size={16} weight="regular" />
											</button>
										)}
										<button
											type="button"
											className={`desk-compose-send${draft.trim() || attachments.length > 0 ? " is-on" : ""}`}
											disabled={listening || (!draft.trim() && attachments.length === 0)}
											onClick={() => void submit()}
											aria-label={status === "running" || status === "approval" ? "Queue" : "Send"}
										>
											<PaperPlaneTilt size={16} weight="regular" />
										</button>
									</div>
								</div>
							</fieldset>
						</div>
					</footer>
				) : null}
				{notice ? (
					<div className="desk-notice-host">
						<FloatNotice key={notice.id} text={notice.text} onDismiss={dismissNotice} />
					</div>
				) : null}
			</section>
			{sessionMenu ? (
				<div
					ref={sessionMenuRef}
					className="desk-menu cel-float"
					role="menu"
					aria-label="Chat"
					style={{ left: sessionMenu.x, top: sessionMenu.y }}
				>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							setRenameDraft(sessionMenu.label);
							setRenamingId(sessionMenu.id);
							setSessionMenu(null);
						}}
					>
						<PencilSimple size={16} weight="regular" />
						Rename
					</button>
					<button
						type="button"
						role="menuitem"
						className="is-danger"
						onClick={() => void removeChat(sessionMenu.id)}
					>
						<Trash size={16} weight="regular" />
						Delete
					</button>
				</div>
			) : null}
		</div>
	);
}

function IntegrationMark(props: { item: PublicIntegration }): React.ReactElement {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return <span className="desk-integration-glyph desk-integration-mark">{props.item.glyph}</span>;
	}
	return (
		<span className="desk-integration-mark">
			<img src={props.item.logoUrl} alt="" width={20} height={20} onError={() => setFailed(true)} />
		</span>
	);
}

function IntegrationRow(props: {
	item: PublicIntegration;
	pending: boolean;
	onConnect: () => void;
	onDisconnect: () => void;
}): React.ReactElement {
	const { item } = props;
	return (
		<li>
			<IntegrationMark item={item} />
			<div>
				<p>{item.label}</p>
				<em>{item.description}</em>
			</div>
			<div className="desk-integration-actions">
				{props.pending ? (
					<span className="desk-integration-ok">
						<span className="cel-chip__spin" aria-hidden="true" />
						{item.connected ? "Disconnecting" : "Connecting"}
					</span>
				) : item.connected ? (
					<>
						<span className="desk-integration-ok">
							<Check size={16} weight="regular" aria-hidden="true" />
							Connected
						</span>
						<button
							type="button"
							className="cel-btn cel-btn--quiet cel-btn--compact"
							onClick={props.onDisconnect}
						>
							Disconnect
						</button>
					</>
				) : (
					<button
						type="button"
						className="cel-btn cel-btn--secondary cel-btn--compact"
						onClick={props.onConnect}
					>
						Connect
					</button>
				)}
			</div>
		</li>
	);
}

function IntegrationsPanel(props: {
	bridge: BridgeClient;
	onNotice: (text: string) => void;
}): React.ReactElement {
	const [items, setItems] = useState<PublicIntegration[] | null>(null);
	const [query, setQuery] = useState("");
	const [loadFailed, setLoadFailed] = useState(false);
	const [pendingId, setPendingId] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		void getIntegrations(props.bridge)
			.then((result) => {
				if (alive) setItems(result.items);
			})
			.catch((err: unknown) => {
				if (!alive) return;
				setLoadFailed(true);
				props.onNotice(err instanceof Error ? err.message : String(err));
			});
		return () => {
			alive = false;
		};
	}, [props.bridge, props.onNotice]);

	const visible = (items ?? []).filter((item) => integrationMatches(item.label, query));
	const ready = visible.filter(
		(item) => item.auth !== "google" && item.auth !== "microsoft" && item.auth !== "desktop",
	);
	const desktop = visible.filter((item) => item.auth === "desktop");
	const setup = visible.filter((item) => item.auth === "google" || item.auth === "microsoft");

	const run = async (id: string, action: "connect" | "disconnect"): Promise<void> => {
		setPendingId(id);
		try {
			const result =
				action === "connect"
					? await connectIntegration(props.bridge, id)
					: await disconnectIntegration(props.bridge, id);
			setItems(result.items);
		} catch (err) {
			props.onNotice(err instanceof Error ? err.message : String(err));
		} finally {
			setPendingId(null);
		}
	};

	if (!items && !loadFailed) {
		return (
			<div className="desk-integrations">
				<p>Loading integrations</p>
			</div>
		);
	}

	if (!items && loadFailed) {
		return (
			<div className="desk-integrations">
				<p className="desk-side-empty">Integrations could not be loaded</p>
			</div>
		);
	}

	return (
		<div className="desk-integrations">
			<p className="desk-integrations-lead">
				Hosted MCP servers the agent can call. App connectors for published sites stay in the
				builder.
			</p>
			<label className="desk-field">
				<span className="visually-hidden">Search integrations</span>
				<input
					className="cel-input"
					value={query}
					placeholder="Search"
					onChange={(event) => setQuery(event.target.value)}
				/>
			</label>
			{visible.length === 0 ? (
				<p className="desk-side-empty">No integrations match</p>
			) : (
				<>
					{ready.length > 0 ? (
						<ul className="desk-integration-list">
							{ready.map((item) => (
								<IntegrationRow
									key={item.id}
									item={item}
									pending={pendingId === item.id}
									onConnect={() => void run(item.id, "connect")}
									onDisconnect={() => void run(item.id, "disconnect")}
								/>
							))}
						</ul>
					) : null}
					{desktop.length > 0 ? (
						<>
							<div className="desk-integration-split">
								<p>Figma desktop required</p>
								<em>
									Remote Figma MCP only allows approved clients. Enable the Dev Mode MCP server in
									Figma desktop, then Connect.
								</em>
							</div>
							<ul className="desk-integration-list">
								{desktop.map((item) => (
									<IntegrationRow
										key={item.id}
										item={item}
										pending={pendingId === item.id}
										onConnect={() => void run(item.id, "connect")}
										onDisconnect={() => void run(item.id, "disconnect")}
									/>
								))}
							</ul>
						</>
					) : null}
					{setup.length > 0 ? (
						<>
							<div className="desk-integration-split">
								<p>OAuth client required</p>
								<em>
									Google Workspace and Microsoft 365 have no dynamic client registration. Add a
									client id in Settings, then Connect.
								</em>
							</div>
							<ul className="desk-integration-list">
								{setup.map((item) => (
									<IntegrationRow
										key={item.id}
										item={item}
										pending={pendingId === item.id}
										onConnect={() => void run(item.id, "connect")}
										onDisconnect={() => void run(item.id, "disconnect")}
									/>
								))}
							</ul>
						</>
					) : null}
				</>
			)}
		</div>
	);
}

function SettingsPanel(props: {
	bridge: BridgeClient;
	theme: ThemeChoice;
	onTheme: (theme: ThemeChoice) => void;
	onSaved: (state: DesktopState) => void;
	onNotice: (text: string) => void;
}): React.ReactElement {
	const [settings, setSettings] = useState<DesktopSettings | null>(null);
	const [apiKey, setApiKey] = useState("");
	const [googleClientId, setGoogleClientId] = useState("");
	const [microsoftClientId, setMicrosoftClientId] = useState("");
	const [microsoftClientSecret, setMicrosoftClientSecret] = useState("");
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		void getSettings(props.bridge).then(setSettings);
	}, [props.bridge]);

	if (!settings) {
		return (
			<div className="desk-settings">
				<p>Loading settings</p>
			</div>
		);
	}

	return (
		<form
			className="desk-settings"
			onSubmit={(event) => {
				event.preventDefault();
				setSaved(false);
				void (async () => {
					try {
						const result = await saveSettings(props.bridge, {
							mode: settings.mode,
							modelId: settings.modelId,
							...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
							...(googleClientId.trim() ? { googleClientId: googleClientId.trim() } : {}),
							...(microsoftClientId.trim() ? { microsoftClientId: microsoftClientId.trim() } : {}),
							...(microsoftClientSecret.trim()
								? { microsoftClientSecret: microsoftClientSecret.trim() }
								: {}),
						});
						setSettings({
							...settings,
							hasApiKey: result.hasApiKey,
							apiKeyHint: result.apiKeyHint,
							hasGoogleOAuth: result.hasGoogleOAuth,
							googleOAuthHint: result.googleOAuthHint,
							hasMicrosoftOAuth: result.hasMicrosoftOAuth,
							microsoftOAuthHint: result.microsoftOAuthHint,
						});
						setApiKey("");
						setGoogleClientId("");
						setMicrosoftClientId("");
						setMicrosoftClientSecret("");
						props.onSaved(result.state);
						setSaved(true);
					} catch (err) {
						props.onNotice(err instanceof Error ? err.message : String(err));
					}
				})();
			}}
		>
			<label>
				<span>OpenRouter API key</span>
				<input
					className="cel-input"
					type="password"
					autoComplete="off"
					spellCheck={false}
					value={apiKey}
					placeholder={settings.hasApiKey ? settings.apiKeyHint : "sk-or-…"}
					onChange={(event) => setApiKey(event.target.value)}
				/>
				<em>
					{settings.hasApiKey
						? `Key on this machine · ${settings.apiKeyHint}`
						: "Stored in ~/.harness on this machine"}
				</em>
			</label>
			<label>
				<span>Google OAuth client id</span>
				<input
					className="cel-input"
					type="text"
					autoComplete="off"
					spellCheck={false}
					value={googleClientId}
					placeholder={settings.hasGoogleOAuth ? settings.googleOAuthHint : ""}
					onChange={(event) => setGoogleClientId(event.target.value)}
				/>
				<em>
					Google Workspace MCP has no dynamic client registration. Register a Desktop app in Google
					Cloud. Loopback redirect and PKCE. No client secret.
				</em>
			</label>
			<label>
				<span>Microsoft Entra client id</span>
				<input
					className="cel-input"
					type="text"
					autoComplete="off"
					spellCheck={false}
					value={microsoftClientId}
					placeholder={settings.hasMicrosoftOAuth ? settings.microsoftOAuthHint : ""}
					onChange={(event) => setMicrosoftClientId(event.target.value)}
				/>
			</label>
			<label>
				<span>Microsoft Entra client secret</span>
				<input
					className="cel-input"
					type="password"
					autoComplete="off"
					spellCheck={false}
					value={microsoftClientSecret}
					placeholder={settings.hasMicrosoftOAuth ? "••••" : ""}
					onChange={(event) => setMicrosoftClientSecret(event.target.value)}
				/>
				<em>
					Required for Microsoft 365 directory MCP. Register a public client in Entra. Dynamic
					client registration is not supported. This server is users and groups, not Excel or
					Outlook.
				</em>
			</label>
			<label>
				<span>Theme</span>
				<span className="desk-select-wrap">
					<select
						className="cel-input desk-select"
						value={props.theme}
						onChange={(event) => props.onTheme(event.target.value as ThemeChoice)}
					>
						<option value="system">System</option>
						<option value="light">Light</option>
						<option value="dark">Dark</option>
					</select>
				</span>
				<em>System follows the OS</em>
			</label>
			<label>
				<span>Mode</span>
				<span className="desk-select-wrap">
					<select
						className="cel-input desk-select"
						value={settings.mode}
						onChange={(event) => setSettings({ ...settings, mode: event.target.value })}
					>
						<option value="ask">Ask</option>
						<option value="plan">Plan</option>
						<option value="agent">Agent</option>
					</select>
				</span>
			</label>
			{saved ? <p className="desk-saved">Saved</p> : null}
			<button type="submit" className="cel-btn cel-btn--secondary cel-btn--compact">
				Save
			</button>
		</form>
	);
}

function ThoughtFold(props: {
	entries: FoldEntry[];
	live: boolean;
	warmupSeed?: number;
}): React.ReactElement {
	const { entries, live, warmupSeed } = props;
	const tools = thoughtTools(entries);
	const summary = thoughtSummary(tools, live, {
		warmup: entries.length === 0,
		seed: warmupSeed ?? 0,
	});
	const hasBody = entries.some((entry) =>
		entry.type === "note" ? entry.text.trim().length > 0 : true,
	);
	if (!hasBody) {
		return (
			<p className="desk-thought desk-thought--plain">
				<span className="desk-thought__headline">{summary.headline}</span>
			</p>
		);
	}
	return (
		<details className="desk-thought">
			<summary>
				<span className="desk-thought__copy">
					<span className="desk-thought__headline">{summary.headline}</span>
					{live && summary.activity ? (
						<span className="desk-thought__activity">{summary.activity}</span>
					) : null}
				</span>
			</summary>
			<div className="desk-thought__body">
				{entries.map((entry, index) => {
					if (entry.type === "note") {
						const text = entry.text.trim();
						if (!text) return null;
						return (
							<p key={`note-${index}`} className="desk-thought__reasoning">
								{text}
							</p>
						);
					}
					return <ToolEventRow key={entry.tool.key} line={entry.tool} />;
				})}
			</div>
		</details>
	);
}

function ToolEventRow(props: { line: ToolLine }): React.ReactElement {
	const { line } = props;
	const count = eventCountSuffix(line.count);
	return (
		<article className={`desk-line desk-line--event is-${line.status}`}>
			<p>
				{line.status === "running" ? (
					<span className="desk-event__spin" aria-hidden="true" />
				) : (
					<Gear size={16} weight="regular" aria-hidden="true" />
				)}
				<span>
					{line.label}
					{count}
				</span>
			</p>
			{line.status === "fail" && line.error ? (
				<p className="desk-event__err">{line.error}</p>
			) : null}
		</article>
	);
}

function TranscriptLine(props: {
	line: StreamLine;
	bridge: BridgeClient | null;
	editing?: string | null;
	onStartEdit?: () => void;
	onEditChange?: (text: string) => void;
	onEditSave?: () => void;
	onEditCancel?: () => void;
	onOpenUrl?: (url: string) => void;
	onOpenFile?: (path: string, reveal: boolean) => void;
}): React.ReactElement {
	const { line, bridge, onOpenUrl, onOpenFile } = props;
	if (line.type === "user") {
		const editing = props.editing != null;
		return (
			<article className={`desk-line desk-line--user${editing ? " is-editing" : ""}`}>
				<p className="desk-line__who">
					{!editing && props.onStartEdit ? (
						<button
							type="button"
							className="cel-btn cel-btn--quiet cel-btn--compact desk-line__edit-btn"
							onClick={props.onStartEdit}
						>
							<PencilSimple size={16} weight="regular" />
							Edit
						</button>
					) : null}
					<span>You</span>
				</p>
				<div className="desk-line__body">
					{editing ? (
						<>
							<textarea
								className="cel-input desk-compose-input"
								rows={3}
								value={props.editing ?? ""}
								aria-label="Edit message"
								onChange={(event) => props.onEditChange?.(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										props.onEditSave?.();
									}
									if (event.key === "Escape") {
										event.preventDefault();
										props.onEditCancel?.();
									}
								}}
							/>
							<div className="desk-line__edit-actions">
								<button
									type="button"
									className="cel-btn cel-btn--secondary cel-btn--compact"
									onClick={props.onEditSave}
								>
									Save
								</button>
								<button
									type="button"
									className="cel-btn cel-btn--quiet cel-btn--compact"
									onClick={props.onEditCancel}
								>
									Cancel
								</button>
							</div>
						</>
					) : (
						<>
							<AttachmentThumbs items={line.attachments ?? []} variant="chat" />
							{line.text ? <p>{line.text}</p> : null}
						</>
					)}
				</div>
			</article>
		);
	}
	if (line.type === "assistant") {
		return (
			<article className="desk-line desk-line--assistant">
				<p className="desk-line__who">Agent</p>
				<div className="desk-line__body">
					<RichBody
						text={line.text}
						bridge={bridge}
						onOpenUrl={onOpenUrl}
						onOpenFile={onOpenFile}
					/>
				</div>
			</article>
		);
	}
	if (line.type === "tool") {
		const count = eventCountSuffix(line.count);
		return (
			<article className={`desk-line desk-line--event is-${line.status}`}>
				<p>
					{line.status === "running" ? (
						<span className="desk-event__spin" aria-hidden="true" />
					) : (
						<Gear size={16} weight="regular" aria-hidden="true" />
					)}
					<span>
						{line.label}
						{count}
					</span>
				</p>
				{line.status === "fail" && line.error ? (
					<p className="desk-event__err">{line.error}</p>
				) : null}
			</article>
		);
	}
	if (line.type === "error") {
		return (
			<article className="desk-line desk-line--error">
				<p>{line.text}</p>
			</article>
		);
	}
	if (line.type === "media") {
		return (
			<article className="desk-line desk-line--assistant">
				<p className="desk-line__who">Agent</p>
				<div className="desk-line__body">
					{line.kind === "video" ? (
						<video className="desk-preview desk-preview--img" controls src={line.src} />
					) : (
						<img className="desk-preview desk-preview--img" src={line.src} alt={line.caption} />
					)}
					<p className="desk-line__caption">{line.caption}</p>
				</div>
			</article>
		);
	}
	return (
		<article className="desk-line desk-line--system">
			<p>{line.text}</p>
		</article>
	);
}

function RichBody(props: {
	text: string;
	bridge: BridgeClient | null;
	onOpenUrl?: (url: string) => void;
	onOpenFile?: (path: string, reveal: boolean) => void;
}): React.ReactElement {
	const parts = splitRichText(props.text);
	return (
		<div className="desk-rich">
			{parts.map((part, index) => {
				if (part.type === "text") {
					const next = parts[index + 1];
					if (next?.type === "image" && /^\s*Preview:?\s*$/i.test(part.text)) return null;
					return <span key={index}>{part.text}</span>;
				}
				if (part.type === "file") {
					return (
						<FileLink
							key={index}
							path={part.path}
							label={part.label}
							onOpenFile={props.onOpenFile}
						/>
					);
				}
				if (part.type === "image") {
					const viewHref = [...parts]
						.reverse()
						.find(
							(item): item is Extract<typeof item, { type: "link" }> =>
								item.type === "link" && item.href.includes("canva.com/d/"),
						)?.href;
					return (
						<PreviewFrame
							key={index}
							src={part.src}
							title={part.alt}
							viewHref={viewHref}
							bridge={props.bridge}
							onOpenUrl={props.onOpenUrl}
						/>
					);
				}
				return (
					<ExternalLink
						key={index}
						href={part.href}
						label={part.label}
						onOpenUrl={props.onOpenUrl}
					/>
				);
			})}
		</div>
	);
}

function FileLink(props: {
	path: string;
	label: string;
	onOpenFile?: (path: string, reveal: boolean) => void;
}): React.ReactElement {
	return (
		<span className="desk-file">
			<button
				type="button"
				className="desk-link"
				onClick={() => props.onOpenFile?.(props.path, false)}
			>
				{props.label}
			</button>
			<button
				type="button"
				className="desk-link desk-link--icon"
				aria-label={`Show ${props.label} in folder`}
				onClick={() => props.onOpenFile?.(props.path, true)}
			>
				<FolderSimple size={16} weight="regular" aria-hidden="true" />
			</button>
		</span>
	);
}

function ExternalLink(props: {
	href: string;
	label: string;
	onOpenUrl?: (url: string) => void;
}): React.ReactElement {
	return (
		<button type="button" className="desk-link" onClick={() => props.onOpenUrl?.(props.href)}>
			<span>{props.label}</span>
			<ArrowUpRight size={16} weight="regular" aria-hidden="true" />
		</button>
	);
}

function PreviewFrame(props: {
	src: string;
	title: string;
	viewHref?: string;
	bridge: BridgeClient | null;
	onOpenUrl?: (url: string) => void;
}): React.ReactElement {
	const [blobSrc, setBlobSrc] = useState<string | null>(null);
	const [mode, setMode] = useState<"load" | "frame" | "expired">("load");
	const openHref = props.viewHref ?? canvaViewUrl(props.src) ?? props.src;

	useEffect(() => {
		let objectUrl: string | undefined;
		let cancelled = false;
		setMode("load");
		setBlobSrc(null);
		void (async () => {
			try {
				if (!props.bridge) {
					if (!cancelled) setMode("expired");
					return;
				}
				const blob = await embedPreview(props.bridge, props.src);
				if (cancelled) return;
				objectUrl = URL.createObjectURL(blob);
				if (cancelled) {
					URL.revokeObjectURL(objectUrl);
					return;
				}
				setBlobSrc(objectUrl);
				setMode("frame");
			} catch {
				if (!cancelled) setMode("expired");
			}
		})();
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [props.bridge, props.src]);

	if (mode === "expired") {
		return (
			<div className="desk-preview desk-preview--empty">
				<p>Preview expired</p>
				<p>The thumbnail link is no longer valid.</p>
				<button
					type="button"
					className="cel-btn cel-btn--tertiary cel-btn--compact"
					onClick={() => props.onOpenUrl?.(openHref)}
				>
					Open in Canva
				</button>
			</div>
		);
	}
	if (mode === "frame" && blobSrc) {
		return <img className="desk-preview desk-preview--img" src={blobSrc} alt={props.title} />;
	}
	return (
		<div className="desk-preview desk-preview--empty" aria-busy="true">
			<span className="cel-chip cel-chip--run">
				<span className="cel-chip__spin" aria-hidden="true" />
				Preview
			</span>
		</div>
	);
}
