import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useCallback,
	useRef,
	useState,
} from "react";
import { resolveSlashSubmit } from "../../src/cli/slash";
import {
	abortTurn,
	approve,
	type BridgeClient,
	type DesktopState,
	type SlashCommand,
	type SlashOutcome,
} from "./api";
import type { ComposerAttachment } from "./composer-files";
import type { MainView, PendingApproval, PickerState, ShowNotice, UiStatus } from "./desk-types";
import { applyDesktopOutcome, runDesktopTurnLoop } from "./desktop-turn";
import { enqueueMessage, promoteQueued, type QueuedMessage, removeQueued } from "./queue";
import type { StreamLine } from "./stream";
import { joinUploadDisplay } from "./user-display";

export function useDeskTurns(input: {
	bridge: BridgeClient | null;
	status: UiStatus;
	draft: string;
	listening: boolean;
	slashOpen: boolean;
	slashItems: SlashCommand[];
	slashIndex: number;
	editingUser: { index: number; text: string; suffix?: string } | null;
	pending: PendingApproval | null;
	setState: Dispatch<SetStateAction<DesktopState | null>>;
	setStatus: Dispatch<SetStateAction<UiStatus>>;
	setView: Dispatch<SetStateAction<MainView>>;
	setSkillQuery: Dispatch<SetStateAction<string>>;
	setDraft: Dispatch<SetStateAction<string>>;
	setLines: Dispatch<SetStateAction<StreamLine[]>>;
	setPending: Dispatch<SetStateAction<PendingApproval | null>>;
	setPicker: Dispatch<SetStateAction<PickerState | null>>;
	setEditingUser: Dispatch<SetStateAction<{ index: number; text: string; suffix?: string } | null>>;
	pushSystem: (text: string) => void;
	refreshSessions: (client: BridgeClient) => Promise<void>;
	showNotice: ShowNotice;
	noticeError: (err: unknown) => void;
	takeAttachments: () => ComposerAttachment[];
	attachmentsRef: MutableRefObject<ComposerAttachment[]>;
	sendingRef: MutableRefObject<boolean>;
}) {
	const {
		bridge,
		status,
		draft,
		listening,
		slashOpen,
		slashItems,
		slashIndex,
		editingUser,
		pending,
		setState,
		setStatus,
		setView,
		setSkillQuery,
		setDraft,
		setLines,
		setPending,
		setPicker,
		setEditingUser,
		pushSystem,
		refreshSessions,
		showNotice,
		noticeError,
		takeAttachments,
		attachmentsRef,
		sendingRef,
	} = input;

	const [queue, setQueue] = useState<QueuedMessage[]>([]);
	const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
	const [queueOpen, setQueueOpen] = useState(true);
	const queueRef = useRef<QueuedMessage[]>([]);
	const skipDrainRef = useRef(false);

	const setQueueSync = useCallback((next: QueuedMessage[]) => {
		queueRef.current = next;
		setQueue(next);
	}, []);

	const applyOutcome = useCallback(
		async (outcome: SlashOutcome, nextState?: DesktopState) => {
			await applyDesktopOutcome(
				{
					bridge,
					pushSystem,
					refreshSessions,
					setState,
					setDraft,
					setLines,
					setPicker,
					setStatus,
				},
				outcome,
				nextState,
			);
		},
		[bridge, pushSystem, refreshSessions, setDraft, setLines, setPicker, setState, setStatus],
	);

	const sendTurn = useCallback(
		async (message: string, editUserTurn?: number, files: ComposerAttachment[] = []) => {
			if (!bridge) return;
			sendingRef.current = true;
			skipDrainRef.current = false;
			try {
				await runDesktopTurnLoop(
					{
						bridge,
						applyOutcome,
						noticeError,
						refreshSessions,
						showNotice,
						setSkillQuery,
						setView,
						setDraft,
						setStatus,
						setLines,
						setState,
						setPending,
						setQueue,
						skipDrainRef,
						queueRef,
					},
					message,
					editUserTurn,
					files,
				);
			} finally {
				sendingRef.current = false;
				setPending(null);
				setStatus((current) => (current === "picker" ? current : "idle"));
			}
		},
		[
			applyOutcome,
			bridge,
			noticeError,
			refreshSessions,
			setDraft,
			setLines,
			setPending,
			setSkillQuery,
			setState,
			setStatus,
			setView,
			showNotice,
		],
	);

	const submit = useCallback(async () => {
		if (!bridge || listening || status === "picker" || status === "boot") return;
		const message = draft.trim();
		const files = attachmentsRef.current;
		if (!message && files.length === 0) return;
		const selected = slashOpen ? slashItems[slashIndex] : undefined;
		const slash = message ? resolveSlashSubmit(message, selected) : undefined;
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
			setQueueOpen(true);
			return;
		}
		await sendTurn(toSend, undefined, pendingFiles);
	}, [
		attachmentsRef,
		bridge,
		draft,
		listening,
		sendTurn,
		setDraft,
		setQueueSync,
		setView,
		slashIndex,
		slashItems,
		slashOpen,
		status,
		takeAttachments,
	]);

	const sendQueuedNow = useCallback(
		async (id: string) => {
			const item = queueRef.current.find((row) => row.id === id);
			if (!item || !bridge) return;
			if (status === "running" || status === "approval" || sendingRef.current) {
				setQueueSync(promoteQueued(queueRef.current, id));
				return;
			}
			setQueueSync(removeQueued(queueRef.current, id));
			await sendTurn(item.text, undefined, item.attachments ?? []);
		},
		[bridge, sendTurn, setQueueSync, status],
	);

	const stop = useCallback(async () => {
		if (!bridge) return;
		await abortTurn(bridge);
	}, [bridge]);

	const commitEdit = useCallback(async () => {
		if (!bridge || !editingUser) return;
		const text = joinUploadDisplay(editingUser.text, editingUser.suffix);
		if (!text.trim()) return;
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
	}, [bridge, editingUser, sendTurn, setEditingUser, status]);

	const decide = useCallback(
		async (decision: "yes" | "no" | "always" | "copy" | "original") => {
			if (!bridge || !pending) return;
			await approve(bridge, {
				callId: pending.callId,
				decision,
				toolName: pending.toolName,
			});
			setPending(null);
			setStatus("running");
		},
		[bridge, pending, setPending, setStatus],
	);

	return {
		queue,
		queueRef,
		queueOpen,
		setQueueOpen,
		editingQueuedId,
		setEditingQueuedId,
		setQueueSync,
		sendTurn,
		submit,
		sendQueuedNow,
		stop,
		commitEdit,
		decide,
	};
}
