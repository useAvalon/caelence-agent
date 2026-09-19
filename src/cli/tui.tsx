import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveOpenRouter } from "../config.ts";
import type { ApprovalRequest } from "../core/approval.ts";
import { isUploadEditRequest } from "../core/approval.ts";
import { errorMessage } from "../core/errors.ts";
import type { AgentEvent } from "../core/events.ts";
import type { Session } from "../core/session.ts";
import { formatUsage, type TokenUsage } from "../core/usage.ts";
import { readMediaPrefs } from "../media/prefs.ts";
import { PRODUCT_NAME } from "../product.ts";
import type { HarnessRuntime } from "../runtime.ts";
import { formatMediaComposerLine } from "./media-models.ts";
import { HARNESS_MODELS } from "./models.ts";
import { cachedLiveTargetNames, loadLiveTargetNames } from "./openrouter-live.ts";
import {
	inkPickerNav,
	type PickerItem,
	paintPickerLine,
	pickerPage,
	pickerVisibleRows,
	sessionPickerItems,
	stepIndex,
} from "./picker.ts";
import { plainTerminalText } from "./plain-text.ts";
import {
	completeSlashCommand,
	draftAfterPicker,
	filterSlashCommands,
	formatSlashCommand,
	resolveSlashSubmit,
} from "./slash.ts";
import { applyPickerChoice, dispatchSlash, type SlashPickerKind } from "./slash-dispatch.ts";
import type { Theme } from "./theme.ts";
import {
	clipLabel,
	sidebarWidth,
	takeVisibleLines,
	tuiChromeRows,
	visibleTranscriptCount,
} from "./tui-layout.ts";
import { enterAltScreen } from "./tui-screen.ts";
import { TuiTextInput } from "./tui-text-input.tsx";

type ToolStatus = "running" | "ok" | "fail";

type StreamLine =
	| { key: string; type: "user"; text: string }
	| { key: string; type: "assistant"; text: string }
	| {
			key: string;
			type: "tool";
			name: string;
			callId: string;
			status: ToolStatus;
			preview: string;
			error?: string;
	  }
	| { key: string; type: "system"; text: string }
	| { key: string; type: "error"; text: string }
	| { key: string; type: "todos"; text: string };

type UiStatus = "idle" | "running" | "approval" | "picker";

type PickerState = {
	title: string;
	items: PickerItem[];
	index: number;
	kind: SlashPickerKind;
};

function previewInput(input: Record<string, unknown>): string {
	const cmd = typeof input.command === "string" ? input.command : undefined;
	const path = typeof input.path === "string" ? input.path : undefined;
	const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
	const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
	const label = typeof input.label === "string" ? input.label : undefined;
	const raw = label ?? cmd ?? path ?? pattern ?? prompt ?? JSON.stringify(input);
	return raw.length > 80 ? `${raw.slice(0, 79)}…` : raw;
}

function applyEvent(lines: StreamLine[], event: AgentEvent): StreamLine[] {
	switch (event.kind) {
		case "text_delta": {
			const last = lines.at(-1);
			if (last?.type === "assistant") {
				return [...lines.slice(0, -1), { ...last, text: last.text + event.text }];
			}
			return [...lines, { key: `a-${lines.length}`, type: "assistant", text: event.text }];
		}
		case "reasoning_delta":
			return lines;
		case "tool_call_start":
			return [
				...lines,
				{
					key: event.callId,
					type: "tool",
					name: event.toolName,
					callId: event.callId,
					status: "running",
					preview: previewInput(event.input),
				},
			];
		case "tool_call_end":
			return lines.map((line) =>
				line.type === "tool" && line.callId === event.callId
					? {
							...line,
							status: event.success ? "ok" : "fail",
							error: event.error,
						}
					: line,
			);
		case "session_meta":
			return lines;
		case "error":
			return [...lines, { key: `e-${lines.length}`, type: "error", text: event.message }];
		case "todos":
			return [
				...lines,
				{
					key: `todo-${lines.length}`,
					type: "todos",
					text: event.items.map((item) => `${item.status} ${item.content}`).join(" · "),
				},
			];
		case "usage":
		case "completion":
		case "approval_request":
			return lines;
	}
}

function modelLabel(id: string): string {
	return HARNESS_MODELS.find((model) => model.id === id)?.label ?? id;
}

function useTerminalSize(): { columns: number; rows: number } {
	const { stdout } = useStdout();
	const [size, setSize] = useState({
		columns: stdout.columns || 80,
		rows: stdout.rows || 24,
	});
	useEffect(() => {
		const onResize = () =>
			setSize({
				columns: stdout.columns || 80,
				rows: stdout.rows || 24,
			});
		stdout.on("resize", onResize);
		return () => {
			stdout.off("resize", onResize);
		};
	}, [stdout]);
	return size;
}

function headerStatusMark(status: UiStatus): string {
	if (status === "running") return "·";
	if (status === "approval") return "!";
	return "●";
}

function headerStatusColor(status: UiStatus, theme: Theme): string {
	if (status === "running") return theme.action;
	if (status === "approval") return theme.warning;
	return theme.brand;
}

function Header(
	props: Readonly<{
		theme: Theme;
		model: string;
		cwd: string;
		title: string;
		status: UiStatus;
		mode: string;
		spend?: string;
	}>,
): React.ReactElement {
	const mark = headerStatusMark(props.status);
	const color = headerStatusColor(props.status, props.theme);
	const label = modelLabel(props.model);
	const target = cachedLiveTargetNames().get(props.model);
	return (
		<Box flexDirection="column">
			<Box>
				<Text color={color}>{mark}</Text>
				<Text color={props.theme.ink} bold>
					{" "}
					{PRODUCT_NAME}
				</Text>
				<Text color={props.theme.muted}>
					{" "}
					{props.title} · {props.mode} · {label}
					{target && target.toLowerCase() !== label.toLowerCase() ? ` · ${target}` : ""}
					{props.spend ? ` · ${props.spend}` : ""}
				</Text>
			</Box>
			<Text color={props.theme.line}>{clipLabel(props.cwd, 72)}</Text>
		</Box>
	);
}

function Sidebar(
	props: Readonly<{
		theme: Theme;
		width: number;
		height: number;
		sessions: PickerItem[];
		currentId?: string;
	}>,
): React.ReactElement {
	const inner = Math.max(8, props.width - 2);
	const slots = Math.max(3, props.height - 6);
	const items = props.sessions.slice(0, slots);
	return (
		<Box
			flexDirection="column"
			width={props.width}
			height={props.height}
			paddingRight={1}
			borderStyle="single"
			borderColor={props.theme.line}
		>
			<Text color={props.theme.brand} bold>
				Caelence
			</Text>
			<Text color={props.theme.muted}>agent</Text>
			<Text color={props.theme.line}> </Text>
			<Text color={props.theme.muted}>Sessions</Text>
			{items.length === 0 ? (
				<Text color={props.theme.line}>No saved sessions</Text>
			) : (
				items.map((item) => (
					<Text
						key={item.id}
						color={item.id === props.currentId ? props.theme.brand : props.theme.ink}
						wrap="truncate"
					>
						{item.id === props.currentId ? "› " : "  "}
						{clipLabel(item.label, inner - 2)}
					</Text>
				))
			)}
			<Box flexGrow={1} />
			<Text color={props.theme.line}>/resume</Text>
			<Text color={props.theme.line}>/settings</Text>
		</Box>
	);
}

function toolStatusMark(status: ToolStatus): string {
	if (status === "running") return "…";
	if (status === "ok") return "✓";
	return "×";
}

function toolStatusColor(status: ToolStatus, theme: Theme): string {
	if (status === "running") return theme.action;
	if (status === "ok") return theme.done;
	return theme.danger;
}

function StreamLineView(props: Readonly<{ theme: Theme; line: StreamLine }>): React.ReactElement {
	const { theme, line } = props;
	if (line.type === "user") {
		return (
			<Box marginBottom={1}>
				<Text color={theme.brand}>› </Text>
				<Text color={theme.ink}>{line.text}</Text>
			</Box>
		);
	}
	if (line.type === "assistant") {
		return (
			<Box marginBottom={1}>
				<Text color={theme.ink}>{plainTerminalText(line.text)}</Text>
			</Box>
		);
	}
	if (line.type === "tool") {
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Text color={toolStatusColor(line.status, theme)}>
					{toolStatusMark(line.status)} {line.name} <Text color={theme.muted}>{line.preview}</Text>
				</Text>
				{line.error ? <Text color={theme.danger}>{line.error}</Text> : null}
			</Box>
		);
	}
	if (line.type === "todos") {
		return (
			<Box marginBottom={1}>
				<Text color={theme.muted}>todos {line.text}</Text>
			</Box>
		);
	}
	if (line.type === "error") {
		return (
			<Box marginBottom={1}>
				<Text color={theme.danger}>{line.text}</Text>
			</Box>
		);
	}
	return (
		<Box marginBottom={1}>
			<Text color={theme.muted}>{line.text}</Text>
		</Box>
	);
}

function StreamView(props: Readonly<{ theme: Theme; lines: StreamLine[] }>): React.ReactElement {
	return (
		<Box flexDirection="column">
			{props.lines.map((line) => (
				<Box key={line.key}>
					<StreamLineView theme={props.theme} line={line} />
				</Box>
			))}
		</Box>
	);
}

function pickerRowText(item: PickerItem, active: boolean): string {
	const mark = active ? "› " : "  ";
	const hint = item.hint ? ` · ${item.hint}` : "";
	return `${mark}${item.label}${hint}`;
}

function PickerMenu(
	props: Readonly<{ theme: Theme; picker: PickerState; width: number; pageSize: number }>,
): React.ReactElement {
	const page = pickerPage(props.picker.items, props.picker.index, props.pageSize);
	const width = Math.max(1, props.width);
	return (
		<Box flexDirection="column" flexGrow={1} marginY={1} width={width} overflow="hidden">
			<Box width={width} height={1} overflow="hidden">
				<Text color={props.theme.muted} wrap="truncate">
					{paintPickerLine(props.picker.title, width)}
				</Text>
			</Box>
			{page.items.map((item, index) => {
				const active = page.offset + index === props.picker.index;
				return (
					<Box key={item.id} width={width} height={1} overflow="hidden">
						<Text color={active ? props.theme.brand : undefined} bold={active} wrap="truncate">
							{paintPickerLine(pickerRowText(item, active), width)}
						</Text>
					</Box>
				);
			})}
			<Box width={width} height={1} overflow="hidden">
				<Text color={props.theme.line} wrap="truncate">
					{paintPickerLine("tab or arrows · enter to choose · esc to cancel", width)}
				</Text>
			</Box>
		</Box>
	);
}

function SlashMenu(
	props: Readonly<{
		theme: Theme;
		items: ReturnType<typeof filterSlashCommands>;
		selected: number;
	}>,
): React.ReactElement {
	if (props.items.length === 0) {
		return <Text color={props.theme.muted}>No matching command</Text>;
	}
	return (
		<Box flexDirection="column" marginTop={1}>
			{props.items.map((item, index) => {
				const active = index === props.selected;
				const mark = active ? "› " : "  ";
				return (
					<Box key={item.name} height={1} overflow="hidden">
						<Text color={active ? props.theme.brand : undefined} bold={active} wrap="truncate">
							{mark}
							{formatSlashCommand(item)} · {item.hint}
						</Text>
					</Box>
				);
			})}
		</Box>
	);
}

function ApprovalCard(props: Readonly<{ theme: Theme; req: ApprovalRequest }>): React.ReactElement {
	const upload = isUploadEditRequest(props.req);
	const command =
		typeof props.req.input.command === "string"
			? props.req.input.command
			: JSON.stringify(props.req.input);
	const copyPath =
		typeof props.req.input.copyPath === "string" ? props.req.input.copyPath : undefined;
	const originalPath =
		typeof props.req.input.originalPath === "string" ? props.req.input.originalPath : undefined;
	return (
		<Box
			flexDirection="column"
			marginY={1}
			borderStyle="single"
			borderColor={props.theme.warning}
			paddingX={1}
		>
			<Text color={props.theme.warning}>
				{upload ? "Edit this file where?" : `Approval needed · ${props.req.toolName}`}
			</Text>
			{upload ? (
				<>
					<Text color={props.theme.ink}>Copy: {copyPath}</Text>
					<Text color={props.theme.ink}>Original: {originalPath}</Text>
					<Text color={props.theme.muted}>c copy · o original · n cancel</Text>
				</>
			) : (
				<>
					<Text color={props.theme.ink}>{command}</Text>
					<Text color={props.theme.muted}>y approve · n deny · a always this session</Text>
				</>
			)}
		</Box>
	);
}

function pickerSelectedValue(picker: SlashPickerKind, harness: HarnessRuntime): string | undefined {
	if (picker === "model") return harness.modelId;
	if (picker === "mode") return harness.mode;
	const prefs = readMediaPrefs();
	if (picker === "image") return prefs.imageModel;
	if (picker === "video") return prefs.videoModel;
	if (picker === "transcribe") return prefs.transcribeModel;
	return undefined;
}

function approvalDecision(
	input: string,
	escaped: boolean,
	upload: boolean,
): "yes" | "no" | "always" | "copy" | "original" | undefined {
	if (upload) {
		if (input === "c" || input === "C") return "copy";
		if (input === "o" || input === "O") return "original";
		if (input === "n" || input === "N" || escaped) return "no";
		return undefined;
	}
	if (input === "y" || input === "Y") return "yes";
	if (input === "a" || input === "A") return "always";
	if (input === "n" || input === "N" || escaped) return "no";
	return undefined;
}

function slashMenuNav(
	key: { upArrow: boolean; downArrow: boolean; tab: boolean },
	slashOpen: boolean,
	count: number,
): "up" | "down" | "tab" | undefined {
	if (!slashOpen || count === 0) return undefined;
	if (key.upArrow) return "up";
	if (key.downArrow) return "down";
	if (key.tab) return "tab";
	return undefined;
}

function applyPickerKeys(
	picker: PickerState,
	key: {
		escape: boolean;
		upArrow: boolean;
		downArrow: boolean;
		tab: boolean;
		shift: boolean;
		return: boolean;
	},
	setPicker: (
		value: PickerState | null | ((current: PickerState | null) => PickerState | null),
	) => void,
	setStatus: (status: UiStatus) => void,
	setValue: (value: string) => void,
	onEnter: (picker: PickerState) => void,
): void {
	const nav = inkPickerNav(key);
	if (nav === "esc") {
		const next = draftAfterPicker(picker.kind);
		setPicker(null);
		setStatus("idle");
		if (next) setValue(next);
		return;
	}
	if (nav === "enter") {
		onEnter(picker);
		return;
	}
	if (typeof nav === "number") {
		setPicker((current) =>
			current
				? { ...current, index: stepIndex(current.index, current.items.length, nav) }
				: current,
		);
	}
}

function trySlashMenuInput(
	key: { upArrow: boolean; downArrow: boolean; tab: boolean },
	slashOpen: boolean,
	slashItems: ReturnType<typeof filterSlashCommands>,
	slashIndex: number,
	setSlashIndex: (fn: (index: number) => number) => void,
	setValue: (value: string) => void,
): void {
	const slashKey = slashMenuNav(key, slashOpen, slashItems.length);
	if (slashKey === "up") {
		setSlashIndex((index) => stepIndex(index, slashItems.length, -1));
		return;
	}
	if (slashKey === "down") {
		setSlashIndex((index) => stepIndex(index, slashItems.length, 1));
		return;
	}
	if (slashKey === "tab") {
		const selected = slashItems[slashIndex] ?? slashItems[0];
		if (selected) setValue(completeSlashCommand(selected));
	}
}

function ComposerFooter(
	props: Readonly<{
		theme: Theme;
		status: UiStatus;
		statusLabel: string;
		value: string;
		onChange: (value: string) => void;
		onSubmit: (value: string) => void;
		slashOpen: boolean;
		slashItems: ReturnType<typeof filterSlashCommands>;
		slashIndex: number;
		mediaLine: string;
		pickerOpen: boolean;
	}>,
): React.ReactElement | null {
	if (props.pickerOpen || props.status === "picker") return null;
	if (props.status !== "idle") {
		return <Text color={props.theme.muted}>{props.statusLabel}</Text>;
	}
	return (
		<Box flexDirection="column">
			<Box>
				<Text color={props.theme.brand}>› </Text>
				<TuiTextInput value={props.value} onChange={props.onChange} onSubmit={props.onSubmit} />
			</Box>
			{props.slashOpen ? (
				<SlashMenu
					theme={props.theme}
					items={props.slashItems}
					selected={Math.min(props.slashIndex, Math.max(props.slashItems.length - 1, 0))}
				/>
			) : (
				<Text color={props.theme.line}>{props.mediaLine}</Text>
			)}
		</Box>
	);
}

function App(props: Readonly<{ harness: HarnessRuntime }>): React.ReactElement {
	const { harness } = props;
	const theme = harness.theme;
	const { exit } = useApp();
	const [lines, setLines] = useState<StreamLine[]>([]);
	const [value, setValue] = useState("");
	const [status, setStatus] = useState<UiStatus>("idle");
	const [title, setTitle] = useState("New chat");
	const [model, setModel] = useState(harness.modelId);
	const [mode, setMode] = useState(harness.mode);
	const [mediaLine, setMediaLine] = useState(() => formatMediaComposerLine(readMediaPrefs()));
	const [spend, setSpend] = useState<TokenUsage | undefined>(harness.spend);
	const [slashIndex, setSlashIndex] = useState(0);
	const { columns, rows } = useTerminalSize();
	const [sessions, setSessions] = useState<PickerItem[]>([]);
	const [picker, setPicker] = useState<PickerState | null>(null);
	const [pending, setPending] = useState<{
		req: ApprovalRequest;
		resolve: (ok: boolean) => void;
	} | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const pickerRef = useRef(picker);
	pickerRef.current = picker;
	const pickerEscTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (pickerEscTimer.current) clearTimeout(pickerEscTimer.current);
		};
	}, []);

	const slashItems = useMemo(() => filterSlashCommands(value), [value]);
	const slashOpen = status === "idle" && !picker && value.startsWith("/");

	useEffect(() => {
		setSlashIndex(0);
	}, [value]);

	useEffect(() => {
		if (!harness.hasApiKey) return;
		void loadLiveTargetNames(resolveOpenRouter(harness.config)).then(() => {
			setModel((current) => current);
		});
	}, [harness]);

	const refreshSessions = useCallback(async () => {
		setSessions(sessionPickerItems(await harness.store.list()));
	}, [harness]);

	const refreshMedia = useCallback(() => {
		setMediaLine(formatMediaComposerLine(readMediaPrefs()));
	}, []);

	useEffect(() => {
		void refreshSessions();
	}, [refreshSessions, title]);

	const pushSystem = useCallback((text: string) => {
		setLines((prev) => [
			...prev,
			{ key: `sys-${prev.length}-${Date.now()}`, type: "system", text },
		]);
	}, []);

	const applySession = useCallback(
		(session: Session) => {
			harness.setSession(session.id);
			setTitle(session.title);
			if (session.model) {
				harness.setModel(session.model);
				setModel(session.model);
			}
			setLines(
				session.messages
					.filter((m): m is Extract<typeof m, { kind: "turn" }> => m.kind === "turn")
					.map((m, i) =>
						m.role === "user"
							? { key: `u-${i}`, type: "user" as const, text: m.content }
							: { key: `a-${i}`, type: "assistant" as const, text: m.content },
					),
			);
			pushSystem(`Resumed ${session.title}`);
		},
		[harness, pushSystem],
	);

	const confirmPicker = useCallback(
		(state: PickerState) => {
			const item = state.items[state.index];
			if (!item) return;
			setPicker(null);
			if (state.kind === "resume") {
				setStatus("idle");
				void harness.store.get(item.id).then((session) => {
					if (!session) {
						pushSystem(`No session ${item.label}`);
						return;
					}
					applySession(session);
				});
				return;
			}
			if (state.kind === "integration") setStatus("running");
			else setStatus("idle");
			void applyPickerChoice(harness, state.kind, item.id)
				.then((result) => {
					if (result.kind === "text") {
						pushSystem(result.text);
					}
					setModel(harness.modelId);
					setMode(harness.mode);
					refreshMedia();
					const nextDraft = draftAfterPicker(state.kind);
					if (nextDraft) setValue(nextDraft);
				})
				.catch((err: unknown) => {
					pushSystem(errorMessage(err));
				})
				.finally(() => {
					setStatus("idle");
				});
		},
		[applySession, harness, pushSystem, refreshMedia],
	);

	useInput(
		(input, key) => {
			if (status === "approval" && pending) {
				const decision = approvalDecision(input, key.escape, isUploadEditRequest(pending.req));
				if (!decision) return;
				if (decision === "always") harness.allowRiskyAlways(pending.req.toolName);
				if (
					decision === "original" &&
					typeof pending.req.input.originalPath === "string" &&
					pending.req.input.originalPath.trim()
				) {
					pending.req.input.path = pending.req.input.originalPath;
				}
				pending.resolve(decision !== "no");
				setPending(null);
				setStatus("running");
				return;
			}
			const open = pickerRef.current;
			if (open) {
				const nav = inkPickerNav(key);
				if (nav === "esc") {
					if (pickerEscTimer.current) clearTimeout(pickerEscTimer.current);
					pickerEscTimer.current = setTimeout(() => {
						pickerEscTimer.current = null;
						const still = pickerRef.current;
						if (!still) return;
						applyPickerKeys(
							still,
							{
								escape: true,
								upArrow: false,
								downArrow: false,
								tab: false,
								shift: false,
								return: false,
							},
							setPicker,
							setStatus,
							setValue,
							confirmPicker,
						);
					}, 40);
					return;
				}
				if (pickerEscTimer.current) {
					clearTimeout(pickerEscTimer.current);
					pickerEscTimer.current = null;
				}
				applyPickerKeys(open, key, setPicker, setStatus, setValue, confirmPicker);
				return;
			}
			trySlashMenuInput(key, slashOpen, slashItems, slashIndex, setSlashIndex, setValue);
		},
		{ isActive: true },
	);

	const handleSlash = useCallback(
		async (raw: string) => {
			setStatus("running");
			try {
				const outcome = await dispatchSlash(harness, raw);
				if (outcome.kind === "applied" || outcome.kind === "hold") {
					setModel(harness.modelId);
					setMode(harness.mode);
					refreshMedia();
					return;
				}
				if (outcome.kind === "incomplete") {
					setValue(outcome.draft);
					return;
				}
				if (outcome.kind === "text") {
					pushSystem(outcome.text);
					setModel(harness.modelId);
					setMode(harness.mode);
					return;
				}
				if (outcome.kind === "clear") {
					setTitle("New chat");
					setLines([]);
					pushSystem("New session.");
					void refreshSessions();
					return;
				}
				if (outcome.kind === "session") {
					applySession(outcome.session);
					return;
				}
				if (outcome.kind === "exit") {
					exit();
					return;
				}
				if (outcome.kind === "media") {
					pushSystem(outcome.caption);
					return;
				}
				const currentId = pickerSelectedValue(outcome.picker, harness);
				const selected = currentId
					? Math.max(
							0,
							outcome.items.findIndex((item) => item.id === currentId),
						)
					: 0;
				setStatus("picker");
				setPicker({
					title: outcome.title,
					kind: outcome.picker,
					items: outcome.items,
					index: selected,
				});
			} finally {
				setStatus((current) => (current === "picker" ? current : "idle"));
			}
		},
		[applySession, exit, harness, pushSystem, refreshMedia, refreshSessions],
	);

	const submit = useCallback(
		async (text: string) => {
			const trimmed = text.trim();
			if (!trimmed || status !== "idle") return;
			const selected = slashOpen ? slashItems[slashIndex] : undefined;
			const slash = resolveSlashSubmit(trimmed, selected);
			if (slash?.action === "hold") return;
			if (slash?.action === "complete") {
				setValue(slash.line);
				return;
			}
			setValue("");
			if (slash?.action === "send") {
				await handleSlash(slash.line);
				return;
			}
			setLines((prev) => [...prev, { key: `u-${prev.length}`, type: "user", text: trimmed }]);
			setStatus("running");
			const controller = new AbortController();
			abortRef.current = controller;
			try {
				await harness.runTurn(
					trimmed,
					(event) => {
						if (event.kind === "session_meta") setTitle(event.title);
						if (event.kind === "usage") setSpend(harness.spend);
						setLines((prev) => applyEvent(prev, event));
					},
					{
						signal: controller.signal,
						approvalAsk: (req) =>
							new Promise<boolean>((resolve) => {
								setPending({ req, resolve });
								setStatus("approval");
							}),
					},
				);
			} finally {
				abortRef.current = null;
				setPending(null);
				setStatus("idle");
			}
		},
		[handleSlash, harness, slashIndex, slashItems, slashOpen, status],
	);

	const statusLabel = useMemo(() => {
		if (status === "running") return "running";
		if (status === "approval") return "awaiting approval";
		if (status === "picker") return "";
		return "";
	}, [status]);

	const rail = sidebarWidth(columns);
	const chrome = tuiChromeRows({
		approval: Boolean(pending),
		pickerCount: picker?.items.length ?? 0,
		slashCount: slashOpen ? slashItems.length : 0,
	});
	const shown = takeVisibleLines(lines, visibleTranscriptCount(rows, chrome));
	const mainWidth = rail ? Math.max(40, columns - rail) : columns;

	const main = (
		<Box flexDirection="column" width={mainWidth} height={rows}>
			<Header
				theme={theme}
				model={model}
				cwd={harness.cwd}
				title={title}
				status={status}
				mode={mode}
				spend={spend ? formatUsage(spend) : undefined}
			/>
			{picker ? (
				<Box flexGrow={1} overflow="hidden" width={mainWidth}>
					<PickerMenu
						theme={theme}
						picker={picker}
						width={mainWidth}
						pageSize={pickerVisibleRows(rows)}
					/>
				</Box>
			) : (
				<Box flexDirection="column" flexGrow={1} overflow="hidden">
					<StreamView theme={theme} lines={shown} />
				</Box>
			)}
			{pending ? <ApprovalCard theme={theme} req={pending.req} /> : null}
			<ComposerFooter
				theme={theme}
				status={status}
				statusLabel={statusLabel}
				value={value}
				onChange={setValue}
				onSubmit={submit}
				slashOpen={slashOpen}
				slashItems={slashItems}
				slashIndex={slashIndex}
				mediaLine={mediaLine}
				pickerOpen={Boolean(picker)}
			/>
		</Box>
	);

	if (!rail) return main;
	return (
		<Box width={columns} height={rows} flexDirection="row">
			<Sidebar
				theme={theme}
				width={rail}
				height={rows}
				sessions={sessions}
				currentId={harness.activeSessionId}
			/>
			{main}
		</Box>
	);
}

export async function startTui(harness: HarnessRuntime): Promise<void> {
	const restore = enterAltScreen();
	try {
		const instance = render(<App harness={harness} />, { patchConsole: true });
		await instance.waitUntilExit();
	} finally {
		restore();
		harness.close();
	}
}
