export type ChatTranscriptLine =
	| { kind: "user"; text: string }
	| { kind: "assistant"; text: string }
	| { kind: "thought"; text: string }
	| {
			kind: "tool";
			name: string;
			callId: string;
			status: "ok" | "fail";
			preview: string;
			error?: string;
	  };

export interface DesktopState {
	name: string;
	cwd: string;
	mode: string;
	modelId: string;
	modelLabel: string;
	modelTarget?: string;
	imageModelId?: string;
	imageModelLabel?: string;
	videoModelId?: string;
	videoModelLabel?: string;
	transcribeModelId?: string;
	transcribeModelLabel?: string;
	sessionId?: string;
	title: string;
	spend?: string;
	skills: Array<{ name: string; source: string }>;
	busy: boolean;
	hasApiKey: boolean;
	uploads?: Array<{ name: string; rel: string; sourcePath?: string }>;
}

export interface PickerItem {
	id: string;
	label: string;
	hint?: string;
}

export interface SlashCommand {
	name: string;
	hint: string;
	arg?: boolean;
	slot?: string;
}

export type SlashPickerKind = "model" | "mode" | "resume" | "image" | "video" | "transcribe";

export type SlashOutcome =
	| { kind: "text"; text: string }
	| { kind: "applied" }
	| { kind: "incomplete"; draft: string }
	| { kind: "hold" }
	| { kind: "clear" }
	| {
			kind: "session";
			session: {
				id: string;
				title: string;
				model?: string;
				messages: Array<{ kind: string; role?: string; content?: string }>;
			};
	  }
	| { kind: "picker"; title: string; picker: SlashPickerKind; items: PickerItem[] }
	| {
			kind: "media";
			media: { kind: "image" | "video"; mimeType: string; dataUrl: string };
			caption: string;
	  }
	| { kind: "exit" };

export type AgentEvent =
	| { kind: "text_delta"; text: string }
	| { kind: "reasoning_delta"; text: string }
	| { kind: "tool_call_start"; toolName: string; callId: string; input: Record<string, unknown> }
	| {
			kind: "tool_call_end";
			toolName: string;
			callId: string;
			success: boolean;
			result?: unknown;
			error?: string;
	  }
	| { kind: "approval_request"; callId: string; toolName: string; input: Record<string, unknown> }
	| { kind: "session_meta"; sessionId: string; title: string }
	| {
			kind: "usage";
			promptTokens: number;
			completionTokens: number;
			totalTokens: number;
			costUsd?: number;
	  }
	| { kind: "todos"; items: Array<{ id: string; content: string; status: string }> }
	| { kind: "error"; message: string }
	| { kind: "completion" };

export interface BridgeClient {
	url: string;
	token: string;
}

export async function resolveBridge(): Promise<BridgeClient> {
	if (window.__HARNESS_BRIDGE && window.__HARNESS_TOKEN) {
		return { url: window.__HARNESS_BRIDGE, token: window.__HARNESS_TOKEN };
	}
	const url = import.meta.env.VITE_HARNESS_BRIDGE;
	const token = import.meta.env.VITE_HARNESS_TOKEN;
	if (url && token) return { url, token };
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<BridgeClient>("bridge_info");
}

async function request<T>(bridge: BridgeClient, path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${bridge.token}`);
	if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
	const res = await fetch(`${bridge.url}${path}`, { ...init, headers });
	const type = res.headers.get("content-type") ?? "";
	if (type.includes("text/event-stream")) {
		throw new Error("Expected JSON.");
	}
	const body = (await res.json()) as T & { error?: string };
	if (!res.ok) throw new Error(body.error ?? `Caelence agent returned ${res.status}.`);
	return body;
}

async function requestBlob(bridge: BridgeClient, path: string, init: RequestInit): Promise<Blob> {
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${bridge.token}`);
	if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
	const res = await fetch(`${bridge.url}${path}`, { ...init, headers });
	const type = res.headers.get("content-type") ?? "";
	if (!res.ok) {
		if (type.includes("application/json")) {
			const body = (await res.json()) as { error?: string };
			throw new Error(body.error ?? `Caelence agent returned ${res.status}.`);
		}
		throw new Error(`Caelence agent returned ${res.status}.`);
	}
	return res.blob();
}

export function getState(bridge: BridgeClient): Promise<DesktopState> {
	return request(bridge, "/state");
}

export function getSessions(bridge: BridgeClient): Promise<{ items: PickerItem[] }> {
	return request(bridge, "/sessions");
}

export function getModels(bridge: BridgeClient): Promise<{ items: PickerItem[] }> {
	return request(bridge, "/models");
}

export interface DesktopSettings {
	hasApiKey: boolean;
	apiKeyHint: string;
	mode: string;
	modelId: string;
	modelLabel: string;
	hasGoogleOAuth: boolean;
	googleOAuthHint: string;
	hasMicrosoftOAuth: boolean;
	microsoftOAuthHint: string;
}

export interface PublicIntegration {
	id: string;
	label: string;
	description: string;
	docsUrl: string;
	logoUrl: string;
	logoKind: "mask" | "image";
	glyph: string;
	connected: boolean;
	auth?: "dcr" | "google" | "microsoft" | "desktop";
}

export function getSettings(bridge: BridgeClient): Promise<DesktopSettings> {
	return request(bridge, "/settings");
}

export function getIntegrations(bridge: BridgeClient): Promise<{ items: PublicIntegration[] }> {
	return request(bridge, "/integrations");
}

export interface PublicSkill {
	id: string;
	name: string;
	description: string;
	origin: "bundled" | "skills.sh";
	source: string;
	installs?: number;
	status: "off" | "user" | "project";
}

export interface SkillsPage {
	bundled: PublicSkill[];
	popular: PublicSkill[];
	loaded: PublicSkill[];
}

export function getSkills(bridge: BridgeClient): Promise<SkillsPage> {
	return request(bridge, "/skills");
}

export function getPopularSkills(bridge: BridgeClient): Promise<{ popular: PublicSkill[] }> {
	return request(bridge, "/skills/popular");
}

export function searchSkills(bridge: BridgeClient, q: string): Promise<{ items: PublicSkill[] }> {
	return request(bridge, `/skills/search?q=${encodeURIComponent(q)}`);
}

export function addSkill(bridge: BridgeClient, id: string): Promise<{ ok: boolean } & SkillsPage> {
	return request(bridge, "/skills/add", {
		method: "POST",
		body: JSON.stringify({ id }),
	});
}

export function removeSkill(
	bridge: BridgeClient,
	id: string,
): Promise<{ ok: boolean } & SkillsPage> {
	return request(bridge, "/skills/remove", {
		method: "POST",
		body: JSON.stringify({ id }),
	});
}

export function connectIntegration(
	bridge: BridgeClient,
	connectorId: string,
): Promise<{ ok: boolean; items: PublicIntegration[] }> {
	return request(bridge, "/integrations/connect", {
		method: "POST",
		body: JSON.stringify({ connectorId }),
	});
}

export function disconnectIntegration(
	bridge: BridgeClient,
	connectorId: string,
): Promise<{ ok: boolean; items: PublicIntegration[] }> {
	return request(bridge, "/integrations/disconnect", {
		method: "POST",
		body: JSON.stringify({ connectorId }),
	});
}

export interface PublicUserMcp {
	id: string;
	label: string;
	kind: "stdio" | "http";
	detail: string;
	origin: "user" | "config";
	removable: boolean;
}

export interface AddMcpInput {
	label?: string;
	kind: "stdio" | "http";
	command?: string;
	args?: string;
	url?: string;
	token?: string;
}

export function getMcps(bridge: BridgeClient): Promise<{ items: PublicUserMcp[] }> {
	return request(bridge, "/mcp");
}

export function addMcp(
	bridge: BridgeClient,
	input: AddMcpInput,
): Promise<{ ok: boolean; items: PublicUserMcp[] }> {
	return request(bridge, "/mcp/add", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function removeMcp(
	bridge: BridgeClient,
	id: string,
): Promise<{ ok: boolean; items: PublicUserMcp[] }> {
	return request(bridge, "/mcp/remove", {
		method: "POST",
		body: JSON.stringify({ id }),
	});
}

export function openUrl(bridge: BridgeClient, url: string): Promise<{ ok: boolean }> {
	return request(bridge, "/open", {
		method: "POST",
		body: JSON.stringify({ url }),
	});
}

export function embedPreview(bridge: BridgeClient, src: string): Promise<Blob> {
	return requestBlob(bridge, "/embed", {
		method: "POST",
		body: JSON.stringify({ url: src }),
	});
}

export async function openExternal(url: string, bridge?: BridgeClient | null): Promise<void> {
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		await invoke("open_url", { url });
		return;
	} catch {
		// Browser preview, or a binary that does not yet expose open_url.
	}
	if (bridge) {
		await openUrl(bridge, url);
		return;
	}
	const opened = window.open(url, "_blank", "noopener,noreferrer");
	if (!opened) throw new Error("Could not open the link.");
}

export function openPath(
	bridge: BridgeClient,
	path: string,
	reveal = false,
): Promise<{ ok: boolean }> {
	return request(bridge, "/open-path", {
		method: "POST",
		body: JSON.stringify({ path, reveal }),
	});
}

export async function openLocalFile(
	path: string,
	reveal = false,
	bridge?: BridgeClient | null,
): Promise<void> {
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		await invoke("open_path", { path, reveal });
		return;
	} catch {
		// Browser preview, or a binary that does not yet expose open_path.
	}
	if (bridge) {
		await openPath(bridge, path, reveal);
		return;
	}
	throw new Error("Could not open the file.");
}

export function saveSettings(
	bridge: BridgeClient,
	body: {
		apiKey?: string;
		mode?: string;
		modelId?: string;
		googleClientId?: string;
		googleClientSecret?: string;
		microsoftClientId?: string;
		microsoftClientSecret?: string;
	},
): Promise<
	{
		ok: boolean;
		state: DesktopState;
	} & DesktopSettings
> {
	return request(bridge, "/settings", { method: "POST", body: JSON.stringify(body) });
}

export function getSlash(bridge: BridgeClient, q: string): Promise<{ items: SlashCommand[] }> {
	return request(bridge, `/slash?q=${encodeURIComponent(q)}`);
}

export function postSlash(
	bridge: BridgeClient,
	raw: string,
): Promise<{ outcome: SlashOutcome; state: DesktopState }> {
	return request(bridge, "/slash", { method: "POST", body: JSON.stringify({ raw }) });
}

export function postPicker(
	bridge: BridgeClient,
	picker: SlashPickerKind,
	id: string,
): Promise<{
	ok: boolean;
	text?: string;
	state: DesktopState;
	messages?: ChatTranscriptLine[];
}> {
	return request(bridge, "/picker", { method: "POST", body: JSON.stringify({ picker, id }) });
}

export function postSession(
	bridge: BridgeClient,
	body: { id: string } | { clear: true },
): Promise<{
	ok: boolean;
	state: DesktopState;
	messages?: ChatTranscriptLine[];
}> {
	return request(bridge, "/session", { method: "POST", body: JSON.stringify(body) });
}

export function renameSession(
	bridge: BridgeClient,
	id: string,
	title: string,
): Promise<{ ok: boolean; title: string; state: DesktopState }> {
	return request(bridge, "/session", { method: "POST", body: JSON.stringify({ id, title }) });
}

export function deleteSession(
	bridge: BridgeClient,
	id: string,
): Promise<{ ok: boolean; cleared: boolean; state: DesktopState }> {
	return request(bridge, "/session", {
		method: "POST",
		body: JSON.stringify({ id, delete: true }),
	});
}

export function approve(
	bridge: BridgeClient,
	body: {
		callId: string;
		decision: "yes" | "no" | "always" | "copy" | "original";
		toolName?: string;
	},
): Promise<{ ok: boolean }> {
	return request(bridge, "/approve", { method: "POST", body: JSON.stringify(body) });
}

export function abortTurn(bridge: BridgeClient): Promise<{ ok: boolean }> {
	return request(bridge, "/abort", { method: "POST" });
}

export function transcribe(
	bridge: BridgeClient,
	body: { data: string; format: string },
): Promise<{ text: string }> {
	return request(bridge, "/transcribe", { method: "POST", body: JSON.stringify(body) });
}

export async function micStart(): Promise<void> {
	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("mic_start");
}

export async function micStop(): Promise<{ data: string; format: string }> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke("mic_stop");
}

export async function filesFromDroppedPaths(paths: string[]): Promise<File[]> {
	const { invoke } = await import("@tauri-apps/api/core");
	const files: File[] = [];
	for (const path of paths) {
		const trimmed = path.trim();
		if (!trimmed) continue;
		try {
			const item = await invoke<{ name: string; mime: string; data: string }>("read_drop_file", {
				path: trimmed,
			});
			const raw = atob(item.data);
			const bytes = Uint8Array.from(raw, (ch) => ch.codePointAt(0) ?? 0);
			files.push(new File([bytes], item.name, { type: item.mime }));
		} catch {
			// skip unreadable paths
		}
	}
	return files;
}

export interface TurnAttachmentPayload {
	name: string;
	mime: string;
	data: string;
}

export async function startTurn(
	bridge: BridgeClient,
	message: string,
	onEvent?: (event: AgentEvent) => void,
	signal?: AbortSignal,
	editUserTurn?: number,
	attachments?: TurnAttachmentPayload[],
): Promise<{ outcome?: SlashOutcome; state?: DesktopState } | void> {
	const res = await fetch(`${bridge.url}/turn`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${bridge.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			message,
			...(editUserTurn !== undefined ? { editUserTurn } : {}),
			...(attachments && attachments.length > 0 ? { attachments } : {}),
		}),
		signal,
	});
	const type = res.headers.get("content-type") ?? "";
	if (!res.ok) {
		const body = (await res.json()) as { error?: string };
		throw new Error(body.error ?? `Caelence agent returned ${res.status}.`);
	}
	if (!type.includes("text/event-stream")) {
		return (await res.json()) as { outcome?: SlashOutcome; state?: DesktopState };
	}
	if (!res.body) return;
	await readSse(res.body, onEvent);
}

async function readSse(
	body: ReadableStream<Uint8Array>,
	onEvent?: (event: AgentEvent) => void,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const chunks = buffer.split("\n\n");
		buffer = chunks.pop() ?? "";
		for (const chunk of chunks) {
			const line = chunk.split("\n").find((row) => row.startsWith("data:"));
			if (!line) continue;
			const raw = line.slice(5).trim();
			if (!raw) continue;
			onEvent?.(JSON.parse(raw) as AgentEvent);
		}
	}
}

export function isAbortError(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	const name = (err as { name?: unknown }).name;
	if (name === "AbortError" || name === "CancelledError") return true;
	if (err instanceof Error) return /aborted|The operation was aborted/i.test(err.message);
	if (typeof err === "string") return /aborted|The operation was aborted/i.test(err);
	return false;
}
