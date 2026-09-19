import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type BridgeClient,
	type DesktopState,
	deleteSession,
	postSession,
	renameSession,
} from "./api";
import type { MainView, SessionMenuState, UiStatus } from "./desk-types";
import type { QueuedMessage } from "./queue";
import { clampMenuPosition } from "./session-menu";
import { linesFromTranscript, type StreamLine } from "./stream";

export function useDeskSessions(input: {
	bridge: BridgeClient | null;
	status: UiStatus;
	setState: Dispatch<SetStateAction<DesktopState | null>>;
	setView: Dispatch<SetStateAction<MainView>>;
	setEditingUser: Dispatch<SetStateAction<{ index: number; text: string; suffix?: string } | null>>;
	setQueueSync: (next: QueuedMessage[]) => void;
	releaseLinePreviews: (next: StreamLine[]) => void;
	noticeError: (err: unknown) => void;
	refreshSessions: (client: BridgeClient) => Promise<void>;
}) {
	const {
		bridge,
		status,
		setState,
		setView,
		setEditingUser,
		setQueueSync,
		releaseLinePreviews,
		noticeError,
		refreshSessions,
	} = input;
	const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	const sessionMenuRef = useRef<HTMLDivElement>(null);
	const renameInputRef = useRef<HTMLInputElement>(null);
	const skipRenameBlurRef = useRef(false);

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
		[bridge, releaseLinePreviews, setEditingUser, setQueueSync, setState, setView, status],
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
	}, [bridge, releaseLinePreviews, setEditingUser, setQueueSync, setState, setView, status]);

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
	}, [bridge, noticeError, refreshSessions, renameDraft, renamingId, setState]);

	const removeChats = useCallback(
		async (ids: readonly string[]) => {
			if (!bridge || ids.length === 0) return;
			setSessionMenu(null);
			let nextState: DesktopState | undefined;
			let cleared = false;
			for (const id of ids) {
				try {
					const result = await deleteSession(bridge, id);
					nextState = result.state;
					if (result.cleared) cleared = true;
				} catch (err) {
					noticeError(err);
				}
			}
			if (nextState) setState(nextState);
			if (cleared) {
				releaseLinePreviews([]);
				setQueueSync([]);
				setEditingUser(null);
			}
			await refreshSessions(bridge);
		},
		[
			bridge,
			noticeError,
			refreshSessions,
			releaseLinePreviews,
			setEditingUser,
			setQueueSync,
			setState,
		],
	);

	const removeChat = useCallback(
		async (id: string) => {
			await removeChats([id]);
		},
		[removeChats],
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

	return {
		sessionMenu,
		setSessionMenu,
		renamingId,
		setRenamingId,
		renameDraft,
		setRenameDraft,
		sessionMenuRef,
		renameInputRef,
		skipRenameBlurRef,
		openSession,
		newChat,
		commitRename,
		removeChat,
		removeChats,
	};
}
