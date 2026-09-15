import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveOpenRouter } from "../config.ts";
import type { ApprovalRequest } from "../core/approval.ts";
import type { AgentEvent } from "../core/events.ts";
import type { Session } from "../core/session.ts";
import { formatUsage, type TokenUsage } from "../core/usage.ts";
import { readMediaPrefs } from "../media/prefs.ts";
import { PRODUCT_NAME } from "../product.ts";
import type { HarnessRuntime } from "../runtime.ts";
import { formatMediaComposerLine } from "./media-models.ts";
import { HARNESS_MODELS } from "./models.ts";
import { cachedLiveTargetNames, loadLiveTargetNames } from "./openrouter-live.ts";
import { type PickerItem, sessionPickerItems, stepIndex } from "./picker.ts";
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
			const last = lines[lines.length - 1];
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

function Header(props: {
	theme: Theme;
	name: string;
	model: string;
	cwd: string;
	title: string;
	status: UiStatus;
	mode: string;
	spend?: string;
}): React.ReactElement {
	const mark = props.status === "running" ? "·" : props.status === "approval" ? "!" : "●";
	const color =
		props.status === "running"
			? props.theme.action
			: props.status === "approval"
				? props.theme.warning
				: props.theme.brand;
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

function Sidebar(props: {
	theme: Theme;
	width: number;
	height: number;
	sessions: PickerItem[];
	currentId?: string;
}): React.ReactElement {
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

function StreamView(props: { theme: Theme; lines: StreamLine[] }): React.ReactElement {
	return (
		<Box flexDirection="column">
			{props.lines.map((line) => {
				if (line.type === "user") {
					return (
						<Box key={line.key} marginBottom={1}>
							<Text color={props.theme.brand}>› </Text>
							<Text color={props.theme.ink}>{line.text}</Text>
						</Box>
					);
				}
				if (line.type === "assistant") {
					return (
						<Box key={line.key} marginBottom={1}>
							<Text color={props.theme.ink}>{plainTerminalText(line.text)}</Text>
						</Box>
					);
				}
				if (line.type === "tool") {
					const mark = line.status === "running" ? "…" : line.status === "ok" ? "✓" : "×";
					const color =
						line.status === "running"
							? props.theme.action
							: line.status === "ok"
								? props.theme.done
								: props.theme.danger;
					return (
						<Box key={line.key} flexDirection="column" marginBottom={1}>
							<Text color={color}>
								{mark} {line.name} <Text color={props.theme.muted}>{line.preview}</Text>
							</Text>
							{line.error ? <Text color={props.theme.danger}>{line.error}</Text> : null}
						</Box>
					);
				}
				if (line.type === "todos") {
					return (
						<Box key={line.key} marginBottom={1}>
							<Text color={props.theme.muted}>todos {line.text}</Text>
						</Box>
					);
				}
				if (line.type === "error") {
					return (
						<Box key={line.key} marginBottom={1}>
							<Text color={props.theme.danger}>{line.text}</Text>
						</Box>
					);
				}
				return (
					<Box key={line.key} marginBottom={1}>
						<Text color={props.theme.muted}>{line.text}</Text>
					</Box>
				);
			})}
		</Box>
	);
}

function PickerMenu(props: { theme: Theme; picker: PickerState }): React.ReactElement {
	return (
		<Box flexDirection="column" marginY={1}>
			<Text color={props.theme.muted}>{props.picker.title}</Text>
			{props.picker.items.map((item, index) => {
				const active = index === props.picker.index;
				return (
					<Text key={item.id}>
						<Text color={active ? props.theme.brand : props.theme.muted}>
							{active ? "› " : "  "}
						</Text>
						<Text color={active ? props.theme.brand : undefined} bold={active}>
							{item.label}
						</Text>
						{item.hint ? <Text color={props.theme.muted}> · {item.hint}</Text> : null}
					</Text>
				);
			})}
			<Text color={props.theme.line}>tab or arrows · enter to choose · esc to cancel</Text>
		</Box>
	);
}

function SlashMenu(props: {
	theme: Theme;
	items: ReturnType<typeof filterSlashCommands>;
	selected: number;
}): React.ReactElement {
	if (props.items.length === 0) {
		return <Text color={props.theme.muted}>No matching command</Text>;
	}
	return (
		<Box flexDirection="column" marginTop={1}>
			{props.items.map((item, index) => {
				const active = index === props.selected;
				return (
					<Text key={item.name}>
						<Text color={active ? props.theme.brand : props.theme.muted}>
							{active ? "› " : "  "}
						</Text>
						<Text color={active ? props.theme.brand : undefined} bold={active}>
							{formatSlashCommand(item)}
						</Text>
						<Text color={props.theme.muted}> · {item.hint}</Text>
					</Text>
				);
			})}
		</Box>
	);
}

function ApprovalCard(props: { theme: Theme; req: ApprovalRequest }): React.ReactElement {
	const command =
		typeof props.req.input.command === "string"
			? props.req.input.command
			: JSON.stringify(props.req.input);
	return (
		<Box
			flexDirection="column"
			marginY={1}
			borderStyle="single"
			borderColor={props.theme.warning}
			paddingX={1}
		>
			<Text color={props.theme.warning}>Approval needed · {props.req.toolName}</Text>
			<Text color={props.theme.ink}>{command}</Text>
			<Text color={props.theme.muted}>y approve · n deny · a always this session</Text>
		</Box>
	);
}

function App(props: { harness: HarnessRuntime }): React.ReactElement {
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
			setStatus("idle");
			if (state.kind === "resume") {
				void harness.store.get(item.id).then((session) => {
					if (!session) {
						pushSystem(`No session ${item.label}`);
						return;
					}
					applySession(session);
				});
				return;
			}
			const result = applyPickerChoice(harness, state.kind, item.id);
			if (result.kind === "text") {
				pushSystem(result.text);
			}
			setModel(harness.modelId);
			setMode(harness.mode);
			refreshMedia();
			const nextDraft = draftAfterPicker(state.kind);
			if (nextDraft) setValue(nextDraft);
		},
		[applySession, harness, pushSystem, refreshMedia],
	);

	useInput((input, key) => {
		if (status === "approval" && pending) {
			if (input === "y" || input === "Y") {
				pending.resolve(true);
				setPending(null);
				setStatus("running");
			} else if (input === "n" || input === "N") {
				pending.resolve(false);
				setPending(null);
				setStatus("running");
			} else if (input === "a" || input === "A") {
				harness.allowRiskyAlways(pending.req.toolName);
				pending.resolve(true);
				setPending(null);
				setStatus("running");
			} else if (key.escape) {
				pending.resolve(false);
				setPending(null);
				setStatus("running");
			}
			return;
		}
		if (picker) {
			if (key.escape) {
				const next = draftAfterPicker(picker.kind);
				setPicker(null);
				setStatus("idle");
				if (next) setValue(next);
				return;
			}
			if (key.upArrow || (key.tab && key.shift)) {
				setPicker((current) =>
					current
						? { ...current, index: stepIndex(current.index, current.items.length, -1) }
						: current,
				);
				return;
			}
			if (key.downArrow || key.tab) {
				setPicker((current) =>
					current
						? { ...current, index: stepIndex(current.index, current.items.length, 1) }
						: current,
				);
				return;
			}
			if (key.return) {
				confirmPicker(picker);
			}
			return;
		}
		if (status !== "idle" || !slashOpen || slashItems.length === 0) return;
		if (key.upArrow) {
			setSlashIndex((index) => stepIndex(index, slashItems.length, -1));
			return;
		}
		if (key.downArrow) {
			setSlashIndex((index) => stepIndex(index, slashItems.length, 1));
			return;
		}
		if (key.tab) {
			const selected = slashItems[slashIndex] ?? slashItems[0];
			if (selected) setValue(completeSlashCommand(selected));
		}
	});

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
				const prefs = readMediaPrefs();
				const currentId =
					outcome.picker === "model"
						? harness.modelId
						: outcome.picker === "mode"
							? harness.mode
							: outcome.picker === "image"
								? prefs.imageModel
								: outcome.picker === "video"
									? prefs.videoModel
									: outcome.picker === "transcribe"
										? prefs.transcribeModel
										: undefined;
				const selected = currentId
					? Math.max(
							0,
							outcome.items.findIndex((item) => item.id === currentId),
						)
					: 0;
				setPicker({
					title: outcome.title,
					kind: outcome.picker,
					items: outcome.items,
					index: selected,
				});
				setStatus("picker");
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
			const slash = resolveSlashSubmit(trimmed);
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
		[handleSlash, harness, status],
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
				name={harness.config.name}
				model={model}
				cwd={harness.cwd}
				title={title}
				status={status}
				mode={mode}
				spend={spend ? formatUsage(spend) : undefined}
			/>
			<Box flexDirection="column" flexGrow={1} overflow="hidden">
				<StreamView theme={theme} lines={shown} />
			</Box>
			{pending ? <ApprovalCard theme={theme} req={pending.req} /> : null}
			{picker ? <PickerMenu theme={theme} picker={picker} /> : null}
			{status === "idle" ? (
				<Box flexDirection="column">
					<Box>
						<Text color={theme.brand}>› </Text>
						<TextInput value={value} onChange={setValue} onSubmit={submit} />
					</Box>
					{slashOpen ? (
						<SlashMenu
							theme={theme}
							items={slashItems}
							selected={Math.min(slashIndex, Math.max(slashItems.length - 1, 0))}
						/>
					) : (
						<Text color={theme.line}>{mediaLine}</Text>
					)}
				</Box>
			) : status === "picker" ? null : (
				<Text color={theme.muted}>{statusLabel}</Text>
			)}
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
