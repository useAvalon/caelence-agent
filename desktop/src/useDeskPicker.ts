import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { draftAfterPicker } from "../../src/cli/slash";
import { AGENT_MODES } from "../../src/core/mode";
import {
	type BridgeClient,
	type DesktopState,
	getModels,
	type PickerItem,
	postPicker,
} from "./api";
import type { PickerState, UiStatus } from "./desk-types";
import { pickerKeyAction, pickerStartIndex, stepIndex } from "./picker-nav";
import { linesFromTranscript, type StreamLine } from "./stream";

export function useDeskPicker(input: {
	bridge: BridgeClient | null;
	state: DesktopState | null;
	listening: boolean;
	status: UiStatus;
	sendingRef: MutableRefObject<boolean>;
	setState: Dispatch<SetStateAction<DesktopState | null>>;
	setStatus: Dispatch<SetStateAction<UiStatus>>;
	setLines: Dispatch<SetStateAction<StreamLine[]>>;
	setDraft: Dispatch<SetStateAction<string>>;
	pushSystem: (text: string) => void;
	refreshSessions: (client: BridgeClient) => Promise<void>;
	noticeError: (err: unknown) => void;
	inputRef: MutableRefObject<HTMLTextAreaElement | null>;
}) {
	const {
		bridge,
		state,
		listening,
		status,
		sendingRef,
		setState,
		setStatus,
		setLines,
		setDraft,
		pushSystem,
		refreshSessions,
		noticeError,
		inputRef,
	} = input;
	const [picker, setPicker] = useState<PickerState | null>(null);
	const pickerListRef = useRef<HTMLUListElement>(null);
	const pickerRequestRef = useRef(0);

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
			pickerRequestRef.current += 1;
			const requestId = pickerRequestRef.current;
			if (picker?.kind === kind) {
				setPicker(null);
				setStatus("idle");
				return;
			}
			if (kind === "mode") {
				const items = AGENT_MODES.map((id) => ({ id, label: id }));
				setPicker({
					title: "Mode",
					kind: "mode",
					items,
					index: pickerStartIndex(items, state?.mode),
				});
				setStatus("picker");
				return;
			}
			try {
				const result = await getModels(bridge);
				if (requestId !== pickerRequestRef.current) return;
				setPicker({
					title: "Model",
					kind: "model",
					items: result.items,
					index: pickerStartIndex(result.items, state?.modelId),
				});
				setStatus("picker");
			} catch (err) {
				if (requestId !== pickerRequestRef.current) return;
				noticeError(err);
			}
		},
		[bridge, listening, noticeError, picker, sendingRef, setStatus, state, status],
	);

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
		[
			bridge,
			inputRef,
			picker,
			pushSystem,
			refreshSessions,
			setDraft,
			setLines,
			setState,
			setStatus,
		],
	);

	const cancelPicker = useCallback(() => {
		if (!picker) return;
		pickerRequestRef.current += 1;
		const next = draftAfterPicker(picker.kind);
		setPicker(null);
		setStatus("idle");
		if (next) setDraft(next);
		requestAnimationFrame(() => inputRef.current?.focus());
	}, [inputRef, picker, setDraft, setStatus]);

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

	return {
		picker,
		setPicker,
		pickerListRef,
		openComposerPicker,
		choosePicker,
		cancelPicker,
	};
}
