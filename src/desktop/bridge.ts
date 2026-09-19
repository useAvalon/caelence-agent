import { randomBytes } from "node:crypto";
import { mediaModelLabel } from "../cli/media-models.ts";
import { HARNESS_MODELS, modelPickerItems } from "../cli/models.ts";
import { cachedLiveTargetNames, loadLiveTargetNames } from "../cli/openrouter-live.ts";
import { cachedModalityModels } from "../cli/openrouter-modality.ts";
import { sessionPickerItems } from "../cli/picker.ts";
import { isHelpAlias } from "../cli/slash.ts";
import { applyPickerChoice, isSlashPickerKind, runSlashLine } from "../cli/slash-dispatch.ts";
import { resolveOpenRouter } from "../config.ts";
import type { ApprovalRequest } from "../core/approval.ts";
import { errorMessage } from "../core/errors.ts";
import type { AgentEvent } from "../core/events.ts";
import { tryParseAgentMode } from "../core/mode.ts";
import { normalizeSessionTitle, type Session, sessionTranscript } from "../core/session.ts";
import { formatUsage } from "../core/usage.ts";
import {
	connectMcp,
	type OAuthCallback,
	oauthResultPage,
	openSystemBrowser,
} from "../integrations/connect.ts";
import { readProviderOAuth, writeProviderOAuth } from "../integrations/oauth-clients.ts";
import { listPublicIntegrations, removeConnection } from "../integrations/store.ts";
import {
	type AddUserMcpInput,
	addUserMcpServer,
	listPublicMcps,
	removeUserMcpServer,
} from "../mcp/user-servers.ts";
import { transcribeAudio } from "../media/openrouter-generate.ts";
import { readMediaPrefs } from "../media/prefs.ts";
import { PRODUCT_NAME } from "../product.ts";
import { createHarness, type HarnessRuntime } from "../runtime.ts";
import {
	buildSkillsPage,
	cachedPopularSkills,
	decorateCatalogSkill,
	readPopularSkillsCache,
	refreshPopularSkills,
	withDisabledCatalogSkills,
} from "../skills/catalog.ts";
import {
	findSkillForCatalogId,
	isBundledCatalogId,
	searchSkillCatalog,
	skillNameFromCatalogId,
} from "../skills/registry.ts";
import { openResolvedPath, resolveLocalPath } from "./open-local.ts";
import { readPreviewCache, writePreviewCache } from "./preview-cache.ts";
import { applyStoredOpenRouterKey, maskSecret, writeOpenRouterKey } from "./secrets.ts";
import { composeUploadMessage, parseIncomingUploads, saveUploads } from "./uploads.ts";

export interface DesktopState {
	name: string;
	cwd: string;
	mode: string;
	modelId: string;
	modelLabel: string;
	modelTarget?: string;
	imageModelId: string;
	imageModelLabel: string;
	videoModelId: string;
	videoModelLabel: string;
	transcribeModelId: string;
	transcribeModelLabel: string;
	sessionId?: string;
	title: string;
	spend?: string;
	skills: Array<{ name: string; source: string }>;
	busy: boolean;
	hasApiKey: boolean;
}

export interface BridgeReady {
	url: string;
	token: string;
	port: number;
}

export interface StartDesktopBridgeOptions {
	cwd: string;
	host?: string;
	port?: number;
	token?: string;
	harness?: HarnessRuntime;
	openUrl?: (url: string) => void;
	openPath?: (path: string, reveal: boolean) => void;
}

const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "authorization, content-type",
	"access-control-allow-methods": "GET, POST, OPTIONS",
};

function modelLabel(id: string): string {
	return HARNESS_MODELS.find((model) => model.id === id)?.label ?? id;
}

function settingsPayload(harness: HarnessRuntime) {
	const google = readProviderOAuth("google");
	const microsoft = readProviderOAuth("microsoft");
	return {
		hasApiKey: harness.hasApiKey,
		apiKeyHint: harness.hasApiKey ? maskSecret(process.env.OPENROUTER_API_KEY ?? "") : "",
		mode: harness.mode,
		modelId: harness.modelId,
		modelLabel: modelLabel(harness.modelId),
		hasGoogleOAuth: Boolean(google?.clientId),
		googleOAuthHint: google?.clientId ? maskSecret(google.clientId) : "",
		hasMicrosoftOAuth: Boolean(microsoft?.clientId),
		microsoftOAuthHint: microsoft?.clientId ? maskSecret(microsoft.clientId) : "",
	};
}

function saveProviderOAuth(body: Record<string, unknown>, kind: "google" | "microsoft"): void {
	const idKey = kind === "google" ? "googleClientId" : "microsoftClientId";
	const secretKey = kind === "google" ? "googleClientSecret" : "microsoftClientSecret";
	const clientId = typeof body[idKey] === "string" ? body[idKey].trim() : "";
	const clientSecret = typeof body[secretKey] === "string" ? body[secretKey].trim() : "";
	if (!clientId && !clientSecret) return;
	writeProviderOAuth(kind, {
		...(clientId ? { clientId } : {}),
		...(clientSecret ? { clientSecret } : {}),
	});
}

function chatMessages(session: Session | undefined) {
	return session ? sessionTranscript(session) : [];
}

function json(data: unknown, status = 200, extra?: HeadersInit): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json",
			...CORS_HEADERS,
			...extra,
		},
	});
}

function readToken(req: Request): string | undefined {
	const header = req.headers.get("authorization");
	if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
	return new URL(req.url).searchParams.get("token") ?? undefined;
}

function parseHttpUrl(raw: string): URL | null {
	try {
		const parsed = new URL(raw.trim());
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
		return parsed;
	} catch {
		return null;
	}
}

function publicHttpHref(raw: string): string | null {
	const href = raw.trim();
	const parsed = parseHttpUrl(href);
	if (!parsed) return null;
	const host = parsed.hostname.toLowerCase();
	if (
		host === "localhost" ||
		host === "127.0.0.1" ||
		host === "[::1]" ||
		host === "::1" ||
		host.endsWith(".local")
	) {
		return null;
	}
	return href;
}

async function fetchPreview(href: string): Promise<Response> {
	const cached = readPreviewCache(href);
	if (cached) return previewBytes(cached.type, cached.bytes);

	const remote = await fetch(href, {
		headers: {
			Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*,*/*;q=0.8",
			Referer: "https://www.canva.com/",
			"User-Agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
		},
		redirect: "follow",
		signal: AbortSignal.timeout(15_000),
	});
	if (!remote.ok) {
		const fallback = readPreviewCache(href);
		if (fallback) return previewBytes(fallback.type, fallback.bytes);
		return json({ error: `Preview fetch failed (${remote.status}).` }, 502);
	}
	const type =
		(remote.headers.get("content-type") ?? "application/octet-stream").split(";")[0]?.trim() ??
		"application/octet-stream";
	if (!type.startsWith("image/") && type !== "application/pdf") {
		const fallback = readPreviewCache(href);
		if (fallback) return previewBytes(fallback.type, fallback.bytes);
		return json({ error: "Preview is not an image." }, 502);
	}
	const buffer = await remote.arrayBuffer();
	if (buffer.byteLength > 8 * 1024 * 1024) {
		return json({ error: "Preview is larger than 8 MB." }, 413);
	}
	const bytes = new Uint8Array(buffer);
	writePreviewCache(href, type, bytes);
	return previewBytes(type, bytes);
}

function previewBytes(type: string, bytes: Uint8Array): Response {
	return new Response(Buffer.from(bytes), {
		status: 200,
		headers: {
			"content-type": type,
			"cache-control": "private, max-age=3600",
			...CORS_HEADERS,
		},
	});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
	const text = await req.text();
	if (!text.trim()) return {};
	const parsed = JSON.parse(text) as unknown;
	return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

function snapshot(harness: HarnessRuntime, busy: boolean, title: string): DesktopState {
	const live = cachedLiveTargetNames();
	const target = live.get(harness.modelId);
	const prefs = readMediaPrefs();
	return {
		name: harness.config.name,
		cwd: harness.cwd,
		mode: harness.mode,
		modelId: harness.modelId,
		modelLabel: modelLabel(harness.modelId),
		...(target && target.toLowerCase() !== modelLabel(harness.modelId).toLowerCase()
			? { modelTarget: target }
			: {}),
		imageModelId: prefs.imageModel,
		imageModelLabel: mediaModelLabel(cachedModalityModels("image"), prefs.imageModel),
		videoModelId: prefs.videoModel,
		videoModelLabel: mediaModelLabel(cachedModalityModels("video"), prefs.videoModel),
		transcribeModelId: prefs.transcribeModel,
		transcribeModelLabel: mediaModelLabel(
			cachedModalityModels("transcription"),
			prefs.transcribeModel,
		),
		sessionId: harness.activeSessionId,
		title,
		spend: harness.spend ? formatUsage(harness.spend) : undefined,
		skills: harness.skills.map((skill) => ({ name: skill.name, source: skill.source })),
		busy,
		hasApiKey: harness.hasApiKey,
	};
}

export async function startDesktopBridge(options: StartDesktopBridgeOptions): Promise<{
	ready: BridgeReady;
	stop: () => Promise<void>;
}> {
	const host = options.host ?? "127.0.0.1";
	const token = options.token ?? randomBytes(24).toString("hex");
	const openUrl = options.openUrl ?? openSystemBrowser;
	if (!options.harness) applyStoredOpenRouterKey();
	const harness = options.harness ?? (await createHarness({ cwd: options.cwd }));
	const openPath =
		options.openPath ??
		((path: string, reveal: boolean) => {
			const resolved = resolveLocalPath(path, harness.cwd);
			if (!resolved) throw new Error("File is missing.");
			openResolvedPath(resolved, reveal);
		});
	const ownsHarness = !options.harness;
	let title = "New chat";
	let busy = false;
	let abort: AbortController | undefined;
	const pending = new Map<string, (ok: boolean) => void>();
	const oauthWaiters = new Map<string, (result: OAuthCallback) => void>();

	const refreshLiveNames = (): void => {
		if (!harness.hasApiKey) return;
		void loadLiveTargetNames(resolveOpenRouter(harness.config));
	};
	refreshLiveNames();

	const applySession = async (id: string): Promise<{ ok: boolean; error?: string }> => {
		const session = await harness.store.get(id);
		if (!session) return { ok: false, error: `No session ${id}` };
		harness.setSession(session.id);
		if (session.model) harness.setModel(session.model);
		title = session.title.trim() || "New chat";
		return { ok: true };
	};

	const handleOAuthCallback = async (_req: Request, url: URL): Promise<Response> => {
		const state = url.searchParams.get("state")?.trim() ?? "";
		const code = url.searchParams.get("code")?.trim() ?? "";
		const error = url.searchParams.get("error")?.trim() ?? "";
		const resolve = oauthWaiters.get(state);
		if (!resolve) {
			return new Response(
				oauthResultPage(
					false,
					"This sign-in is no longer waiting. Close this tab and try Connect again.",
				),
				{
					status: 400,
					headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
				},
			);
		}
		oauthWaiters.delete(state);
		resolve({ code: code || undefined, error: error || undefined });
		const ok = Boolean(code) && !error;
		return new Response(
			oauthResultPage(
				ok,
				ok
					? "You can close this tab and return to Caelence agent."
					: "Close this tab and try Connect again.",
			),
			{
				status: ok ? 200 : 400,
				headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
			},
		);
	};

	const route_get_health = async (_req: Request, _url: URL): Promise<Response> => {
		return json({ ok: true });
	};

	const route_get_state = async (_req: Request, _url: URL): Promise<Response> => {
		return json(snapshot(harness, busy, title));
	};

	const route_get_sessions = async (_req: Request, _url: URL): Promise<Response> => {
		return json({ items: sessionPickerItems(await harness.store.list()) });
	};

	const route_get_models = async (_req: Request, _url: URL): Promise<Response> => {
		return json({ items: modelPickerItems(harness.modelId, cachedLiveTargetNames()) });
	};

	const route_get_settings = async (_req: Request, _url: URL): Promise<Response> => {
		return json(settingsPayload(harness));
	};

	const route_get_integrations = async (_req: Request, _url: URL): Promise<Response> => {
		return json({ items: listPublicIntegrations() });
	};

	const route_post_integrations_connect = async (req: Request, url: URL): Promise<Response> => {
		const body = await readJson(req);
		const connectorId = typeof body.connectorId === "string" ? body.connectorId.trim() : "";
		if (!connectorId) return json({ error: "connectorId is required." }, 400);
		const redirectUri = `http://127.0.0.1:${url.port}/oauth/callback`;
		try {
			await connectMcp({
				connectorId,
				redirectUri,
				waitForCallback: (state) =>
					new Promise<OAuthCallback>((resolve, reject) => {
						const timer = setTimeout(() => {
							oauthWaiters.delete(state);
							reject(new Error("Sign-in timed out. Try Connect again."));
						}, 180_000);
						oauthWaiters.set(state, (result) => {
							clearTimeout(timer);
							resolve(result);
						});
					}),
			});
			await harness.reloadIntegrations();
			return json({ ok: true, items: listPublicIntegrations() });
		} catch (err) {
			return json({ error: errorMessage(err) }, 400);
		}
	};

	const route_post_integrations_disconnect = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const connectorId = typeof body.connectorId === "string" ? body.connectorId.trim() : "";
		if (!connectorId) return json({ error: "connectorId is required." }, 400);
		removeConnection(connectorId);
		await harness.reloadIntegrations();
		return json({ ok: true, items: listPublicIntegrations() });
	};

	const mcpPage = () => ({ items: listPublicMcps(harness.cwd, harness.config.mcp) });

	const route_get_mcp = async (_req: Request, _url: URL): Promise<Response> => {
		return json(mcpPage());
	};

	const route_post_mcp_add = async (req: Request, _url: URL): Promise<Response> => {
		const body = (await readJson(req)) as AddUserMcpInput;
		const added = addUserMcpServer(harness.cwd, body, harness.config.mcp);
		if ("error" in added) return json({ error: added.error }, 400);
		await harness.reloadExtraMcp();
		return json({ ok: true, ...mcpPage() });
	};

	const route_post_mcp_remove = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const id = typeof body.id === "string" ? body.id.trim() : "";
		if (!id) return json({ error: "id is required." }, 400);
		if (!removeUserMcpServer(harness.cwd, id)) {
			return json({ error: "MCP not found." }, 400);
		}
		await harness.reloadExtraMcp();
		return json({ ok: true, ...mcpPage() });
	};

	const skillsPage = (popular = cachedPopularSkills()) =>
		buildSkillsPage(
			withDisabledCatalogSkills(harness.skills, harness.disabledSkills()),
			popular,
			harness.disabledSkills(),
		);

	const route_get_skills = async (_req: Request, _url: URL): Promise<Response> => {
		return json(skillsPage());
	};

	const route_get_skills_popular = async (_req: Request, _url: URL): Promise<Response> => {
		const cached = readPopularSkillsCache();
		if (!cached.stale) {
			return json({ popular: skillsPage(cached.hits).popular });
		}
		const popular = await refreshPopularSkills();
		return json({ popular: skillsPage(popular).popular });
	};

	const route_get_skills_search = async (_req: Request, url: URL): Promise<Response> => {
		const q = (url.searchParams.get("q") ?? "").trim();
		if (q.length < 2) return json({ items: [] });
		try {
			const hits = await searchSkillCatalog(q);
			return json({
				items: hits.map((hit) =>
					decorateCatalogSkill(
						hit,
						withDisabledCatalogSkills(harness.skills, harness.disabledSkills()),
						harness.disabledSkills(),
					),
				),
			});
		} catch (err) {
			return json({ error: errorMessage(err) }, 502);
		}
	};

	const route_post_skills_add = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const id = typeof body.id === "string" ? body.id.trim() : "";
		if (!id) return json({ error: "id is required." }, 400);
		const name = skillNameFromCatalogId(id);
		if (isBundledCatalogId(id) && harness.disabledSkills().includes(name.toLowerCase())) {
			harness.enableSkill(name);
			return json({ ok: true, ...skillsPage() });
		}
		const loaded = findSkillForCatalogId(harness.skills, id);
		if (loaded?.source !== "user" && loaded) {
			return json({ error: `${loaded.name} is already in the project.` }, 400);
		}
		if (!loaded) {
			const result = await harness.addSkill(id);
			if ("error" in result) return json({ error: result.error }, 400);
		}
		return json({ ok: true, ...skillsPage() });
	};

	const route_post_skills_remove = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const id = typeof body.id === "string" ? body.id.trim() : "";
		const name =
			(typeof body.name === "string" ? body.name.trim() : "") || id || skillNameFromCatalogId(id);
		if (!name) return json({ error: "name is required." }, 400);
		const result = harness.removeSkill(id || name);
		if (!result.ok) return json({ error: result.error ?? "Could not remove." }, 400);
		return json({ ok: true, ...skillsPage() });
	};

	const route_post_open = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const parsed = parseHttpUrl(typeof body.url === "string" ? body.url : "");
		if (!parsed) return json({ error: "Only http and https links can open." }, 400);
		openUrl(parsed.toString());
		return json({ ok: true });
	};

	const route_post_open_path = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const filePath = typeof body.path === "string" ? body.path.trim() : "";
		if (!filePath) return json({ error: "Path is missing." }, 400);
		try {
			openPath(filePath, body.reveal === true);
			return json({ ok: true });
		} catch (err) {
			return json({ error: errorMessage(err) || "Could not open the file." }, 400);
		}
	};

	const route_post_embed = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const href = publicHttpHref(typeof body.url === "string" ? body.url : "");
		if (!href) return json({ error: "Only public http and https URLs can embed." }, 400);
		try {
			return await fetchPreview(href);
		} catch (err) {
			return json({ error: errorMessage(err) || "Preview fetch failed." }, 502);
		}
	};

	const route_get_embed = async (_req: Request, url: URL): Promise<Response> => {
		const href = publicHttpHref(url.searchParams.get("url") ?? "");
		if (!href) return json({ error: "Only public http and https URLs can embed." }, 400);
		try {
			return await fetchPreview(href);
		} catch (err) {
			return json({ error: errorMessage(err) || "Preview fetch failed." }, 502);
		}
	};

	const route_post_transcribe = async (req: Request, _url: URL): Promise<Response> => {
		if (!harness.hasApiKey) {
			return json({ error: "OpenRouter API key is missing. Add it in Settings." }, 400);
		}
		const body = await readJson(req);
		const data = typeof body.data === "string" ? body.data : "";
		const format = typeof body.format === "string" ? body.format.trim() : "webm";
		if (!data) return json({ error: "Recording is empty." }, 400);
		if (data.length > 25_000_000) return json({ error: "Recording is too large." }, 413);
		try {
			const or = resolveOpenRouter(harness.config);
			const text = await transcribeAudio({
				data,
				format: format || "webm",
				model: readMediaPrefs().transcribeModel,
				apiKey: or.apiKey,
				baseUrl: or.baseUrl,
			});
			return json({ text });
		} catch (err) {
			return json({ error: errorMessage(err) || "Transcription failed." }, 502);
		}
	};

	const route_post_settings = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		if (typeof body.apiKey === "string") {
			writeOpenRouterKey(body.apiKey);
			harness.setApiKey(body.apiKey);
			refreshLiveNames();
		}
		if (typeof body.mode === "string") {
			const next = tryParseAgentMode(body.mode);
			if (!next) return json({ error: "Mode is ask, plan, or agent." }, 400);
			harness.setMode(next);
		}
		if (typeof body.modelId === "string" && body.modelId.trim()) {
			harness.setModel(body.modelId.trim());
		}
		saveProviderOAuth(body, "google");
		saveProviderOAuth(body, "microsoft");
		return json({
			ok: true,
			...settingsPayload(harness),
			state: snapshot(harness, busy, title),
		});
	};

	const route_get_slash = async (_req: Request, url: URL): Promise<Response> => {
		const { filterSlashCommands } = await import("../cli/slash.ts");
		return json({ items: filterSlashCommands(url.searchParams.get("q") ?? "/") });
	};

	const route_post_session = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		if (body.clear === true) {
			harness.setSession(undefined);
			title = "New chat";
			return json({ ok: true, state: snapshot(harness, busy, title) });
		}
		const id = typeof body.id === "string" ? body.id.trim() : "";
		if (typeof body.title === "string") return renameSessionHttp(id, body.title);
		if (body.delete === true) return deleteSessionHttp(id);
		const result = await applySession(id);
		if (!result.ok) return json({ error: result.error }, 404);
		const session = await harness.store.get(id);
		return json({
			ok: true,
			state: snapshot(harness, busy, title),
			messages: chatMessages(session),
		});
	};

	const renameSessionHttp = async (id: string, rawTitle: string): Promise<Response> => {
		if (!id) return json({ error: "Session id is required." }, 400);
		const nextTitle = normalizeSessionTitle(rawTitle);
		if (!nextTitle) return json({ error: "Title is empty." }, 400);
		const session = await harness.store.get(id);
		if (!session) return json({ error: `No session ${id}` }, 404);
		const next = await harness.store.setTitle(session, nextTitle);
		if (harness.activeSessionId === id) title = next.title;
		return json({ ok: true, title: next.title, state: snapshot(harness, busy, title) });
	};

	const deleteSessionHttp = async (id: string): Promise<Response> => {
		if (!id) return json({ error: "Session id is required." }, 400);
		if (busy && harness.activeSessionId === id) {
			return json({ error: "A turn is already running." }, 409);
		}
		const wasActive = harness.activeSessionId === id;
		const removed = await harness.store.remove(id);
		if (!removed) return json({ error: `No session ${id}` }, 404);
		if (wasActive) {
			harness.setSession(undefined);
			title = "New chat";
		}
		return json({
			ok: true,
			cleared: wasActive,
			state: snapshot(harness, busy, title),
		});
	};

	const route_post_model = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const id = typeof body.id === "string" ? body.id.trim() : "";
		if (!id) return json({ error: "Model id is required." }, 400);
		harness.setModel(id);
		return json({ ok: true, state: snapshot(harness, busy, title) });
	};

	const route_post_mode = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const next = tryParseAgentMode(typeof body.mode === "string" ? body.mode : undefined);
		if (!next) return json({ error: "Mode is ask, plan, or agent." }, 400);
		harness.setMode(next);
		return json({ ok: true, state: snapshot(harness, busy, title) });
	};

	const route_post_slash = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const raw = typeof body.raw === "string" ? body.raw : "";
		if (!raw.trim()) return json({ error: "Command is empty." }, 400);
		const outcome = await runSlashLine(harness, raw);
		if (outcome.kind === "clear") title = "New chat";
		if (outcome.kind === "session") {
			harness.setSession(outcome.session.id);
			if (outcome.session.model) harness.setModel(outcome.session.model);
			title = outcome.session.title.trim() || "New chat";
		}
		return json({ outcome, state: snapshot(harness, busy, title) });
	};

	const route_post_picker = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const picker = isSlashPickerKind(body.picker) ? body.picker : undefined;
		const id = typeof body.id === "string" ? body.id : "";
		if (!picker || !id) return json({ error: "Picker choice is incomplete." }, 400);
		const result = await applyPickerChoice(harness, picker, id);
		if (result.kind === "session-id") {
			const applied = await applySession(result.id);
			if (!applied.ok) return json({ error: applied.error }, 404);
			const session = await harness.store.get(result.id);
			return json({
				ok: true,
				state: snapshot(harness, busy, title),
				messages: chatMessages(session),
			});
		}
		return json({
			ok: true,
			state: snapshot(harness, busy, title),
			...(result.kind === "text" ? { text: result.text } : {}),
		});
	};

	const route_post_approve = async (req: Request, _url: URL): Promise<Response> => {
		const body = await readJson(req);
		const callId = typeof body.callId === "string" ? body.callId : "";
		const decision = body.decision;
		const resolve = pending.get(callId);
		if (!resolve) return json({ error: "No approval is waiting." }, 404);
		if (decision === "always")
			harness.allowRiskyAlways(typeof body.toolName === "string" ? body.toolName : "exec");
		pending.delete(callId);
		resolve(decision === "yes" || decision === "always");
		return json({ ok: true });
	};

	const route_post_abort = async (_req: Request, _url: URL): Promise<Response> => {
		abort?.abort();
		for (const resolve of pending.values()) resolve(false);
		pending.clear();
		return json({ ok: true });
	};

	const route_post_turn = async (req: Request, _url: URL): Promise<Response> => {
		if (busy) return json({ error: "A turn is already running." }, 409);
		const body = await readJson(req);
		const incoming = typeof body.message === "string" ? body.message : "";
		const editUserTurn = parseEditUserTurn(body.editUserTurn);
		const uploads =
			editUserTurn === undefined && !incoming.trim().startsWith("/")
				? saveUploads(harness.cwd, parseIncomingUploads(body.attachments))
				: [];
		const message = composeUploadMessage(incoming, uploads);
		if (!message.trim()) return json({ error: "Message is empty." }, 400);
		if (editUserTurn === undefined && isHelpAlias(incoming)) {
			const outcome = await runSlashLine(harness, "/help");
			return json({ outcome, state: snapshot(harness, busy, title) });
		}
		if (editUserTurn === undefined && incoming.trim().startsWith("/")) {
			return runSlashTurn(incoming);
		}
		return startTurnStream(message, editUserTurn);
	};

	const parseEditUserTurn = (value: unknown): number | undefined => {
		if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
		return value;
	};

	const runSlashTurn = async (incoming: string): Promise<Response> => {
		const outcome = await runSlashLine(harness, incoming);
		if (outcome.kind === "clear") title = "New chat";
		if (outcome.kind === "session") {
			harness.setSession(outcome.session.id);
			if (outcome.session.model) harness.setModel(outcome.session.model);
			title = outcome.session.title.trim() || "New chat";
		}
		return json({ outcome, state: snapshot(harness, busy, title) });
	};

	const startTurnStream = (message: string, editUserTurn?: number): Response => {
		busy = true;
		abort = new AbortController();
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				let heartbeat: ReturnType<typeof setInterval> | undefined;
				const send = (event: AgentEvent) => {
					if (event.kind === "session_meta") title = event.title;
					try {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
					} catch {
						abort?.abort();
					}
				};
				heartbeat = setInterval(() => {
					try {
						controller.enqueue(encoder.encode(": \n\n"));
					} catch {
						if (heartbeat) clearInterval(heartbeat);
					}
				}, 4_000);
				void harness
					.runTurn(message, send, {
						signal: abort?.signal,
						approvalAsk: (req: ApprovalRequest) =>
							new Promise<boolean>((resolve) => {
								pending.set(req.callId, resolve);
							}),
						...(editUserTurn !== undefined ? { editUserTurn } : {}),
					})
					.catch((err) => {
						send({
							kind: "error",
							message: errorMessage(err),
						});
					})
					.finally(() => {
						if (heartbeat) clearInterval(heartbeat);
						busy = false;
						abort = undefined;
						pending.clear();
						try {
							controller.close();
						} catch {
							// already cancelled by the client
						}
					});
			},
			cancel() {
				abort?.abort();
			},
		});
		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				...CORS_HEADERS,
			},
		});
	};

	const bridgeRoutes: Record<string, (req: Request, url: URL) => Promise<Response>> = {
		"GET /health": route_get_health,
		"GET /state": route_get_state,
		"GET /sessions": route_get_sessions,
		"GET /models": route_get_models,
		"GET /settings": route_get_settings,
		"GET /integrations": route_get_integrations,
		"POST /integrations/connect": route_post_integrations_connect,
		"POST /integrations/disconnect": route_post_integrations_disconnect,
		"GET /mcp": route_get_mcp,
		"POST /mcp/add": route_post_mcp_add,
		"POST /mcp/remove": route_post_mcp_remove,
		"GET /skills": route_get_skills,
		"GET /skills/popular": route_get_skills_popular,
		"GET /skills/search": route_get_skills_search,
		"POST /skills/add": route_post_skills_add,
		"POST /skills/remove": route_post_skills_remove,
		"POST /open": route_post_open,
		"POST /open-path": route_post_open_path,
		"POST /embed": route_post_embed,
		"GET /embed": route_get_embed,
		"POST /transcribe": route_post_transcribe,
		"POST /settings": route_post_settings,
		"GET /slash": route_get_slash,
		"POST /session": route_post_session,
		"POST /model": route_post_model,
		"POST /mode": route_post_mode,
		"POST /slash": route_post_slash,
		"POST /picker": route_post_picker,
		"POST /approve": route_post_approve,
		"POST /abort": route_post_abort,
		"POST /turn": route_post_turn,
	};

	const server = Bun.serve({
		hostname: host,
		port: options.port ?? 0,
		idleTimeout: 0,
		async fetch(req) {
			if (req.method === "OPTIONS") {
				return new Response(null, { status: 204, headers: CORS_HEADERS });
			}
			const url = new URL(req.url);
			if (req.method === "GET" && url.pathname === "/oauth/callback") {
				return handleOAuthCallback(req, url);
			}
			if (readToken(req) !== token) {
				return json({ error: `Unauthorized. Restart ${PRODUCT_NAME}.` }, 401);
			}
			const matched = bridgeRoutes[`${req.method} ${url.pathname}`];
			if (!matched) return json({ error: "Not found." }, 404);
			return matched(req, url);
		},
	});

	const port = server.port;
	if (port === undefined) {
		server.stop(true);
		throw new Error(`${PRODUCT_NAME} did not bind a local port.`);
	}
	const ready: BridgeReady = {
		url: `http://${host}:${port}`,
		token,
		port,
	};

	return {
		ready,
		stop: async () => {
			abort?.abort();
			for (const resolve of pending.values()) resolve(false);
			pending.clear();
			for (const resolve of oauthWaiters.values()) resolve({ error: "cancelled" });
			oauthWaiters.clear();
			server.stop(true);
			if (ownsHarness) {
				harness.close();
				await harness.observability.shutdown();
			}
		},
	};
}

export async function main(): Promise<void> {
	const cwd = process.env.HARNESS_CWD?.trim() || process.cwd();
	const { ready } = await startDesktopBridge({ cwd });
	process.stdout.write(`HARNESS_READY=${JSON.stringify(ready)}\n`);
}

if (import.meta.main) {
	try {
		await main();
	} catch (err) {
		process.stderr.write(`${errorMessage(err)}\n`);
		process.exit(1);
	}
}
