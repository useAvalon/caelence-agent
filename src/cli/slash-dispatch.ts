import { resolveOpenRouter } from "../config.ts";
import { errorMessage } from "../core/errors.ts";
import { AGENT_MODES, tryParseAgentMode } from "../core/mode.ts";
import type { Session } from "../core/session.ts";
import { maskSecret, writeOpenRouterKey } from "../desktop/secrets.ts";
import { listEvalSuites, runNamedEval } from "../evals/runner.ts";
import { connectMcp } from "../integrations/connect.ts";
import { withOAuthLoopback } from "../integrations/loopback.ts";
import {
	listPublicIntegrations,
	type PublicIntegration,
	removeConnection,
} from "../integrations/store.ts";
import { type GeneratedMedia, generateImage, generateVideo } from "../media/openrouter-generate.ts";
import { readMediaPrefs, writeMediaPrefs } from "../media/prefs.ts";
import { isMemoryEnabled, writeMemoryPrefs } from "../memory/prefs.ts";
import { formatMemoryList } from "../memory/prompt.ts";
import { deleteFact, listFacts, matchFact, pinFact, unpinFact } from "../memory/store.ts";
import type { HarnessRuntime } from "../runtime.ts";
import { browseSkillCatalog } from "../skills/catalog.ts";
import {
	findSkillForCatalogId,
	isBundledCatalogId,
	searchSkillCatalog,
	skillCatalogRef,
	skillIsCatalogHit,
	skillNameFromCatalogId,
} from "../skills/registry.ts";
import { parseSkillCommand, SKILL_COMMAND_USAGE } from "../skills/skill-command.ts";
import { type MediaModelOption, mediaModelLabel, mediaPickerItems } from "./media-models.ts";
import { modelPickerItems } from "./models.ts";
import { loadLiveTargetNames } from "./openrouter-live.ts";
import { loadModalityModels, type MediaModality } from "./openrouter-modality.ts";
import { matchListedSession, type PickerItem, sessionPickerItems } from "./picker.ts";
import { formatSkillList, parseSlashLine, resolveSlashSubmit, SLASH_HELP } from "./slash.ts";

export type SlashPickerKind =
	| "model"
	| "mode"
	| "resume"
	| "image"
	| "video"
	| "transcribe"
	| "skill"
	| "integration";

export type SlashOutcome =
	| { kind: "text"; text: string }
	| { kind: "applied" }
	| { kind: "incomplete"; draft: string }
	| { kind: "hold" }
	| { kind: "clear" }
	| { kind: "session"; session: Session }
	| { kind: "picker"; title: string; picker: SlashPickerKind; items: PickerItem[] }
	| { kind: "media"; media: GeneratedMedia; caption: string }
	| { kind: "exit" };

const PICKER_KINDS = new Set<SlashPickerKind>([
	"model",
	"mode",
	"resume",
	"image",
	"video",
	"transcribe",
	"skill",
	"integration",
]);

export function isSlashPickerKind(value: unknown): value is SlashPickerKind {
	return typeof value === "string" && PICKER_KINDS.has(value as SlashPickerKind);
}

async function mediaModels(
	harness: HarnessRuntime,
	modality: MediaModality,
): Promise<readonly MediaModelOption[]> {
	const or = resolveOpenRouter(harness.config);
	return loadModalityModels({
		modality,
		apiKey: harness.hasApiKey ? or.apiKey : "",
		baseUrl: or.baseUrl,
	});
}

async function generateMediaOutcome(
	harness: HarnessRuntime,
	kind: "image" | "video",
	prompt: string,
): Promise<SlashOutcome> {
	if (!harness.hasApiKey) {
		return { kind: "text", text: "OpenRouter API key is missing. Add it in Settings." };
	}
	const or = resolveOpenRouter(harness.config);
	const prefs = readMediaPrefs();
	try {
		if (kind === "image") {
			const media = await generateImage({
				prompt,
				model: prefs.imageModel,
				apiKey: or.apiKey,
				baseUrl: or.baseUrl,
			});
			const models = await mediaModels(harness, "image");
			return {
				kind: "media",
				media,
				caption: `Image · ${mediaModelLabel(models, prefs.imageModel)}`,
			};
		}
		const media = await generateVideo({
			prompt,
			model: prefs.videoModel,
			apiKey: or.apiKey,
			baseUrl: or.baseUrl,
		});
		const models = await mediaModels(harness, "video");
		return {
			kind: "media",
			media,
			caption: `Clip · ${mediaModelLabel(models, prefs.videoModel)}`,
		};
	} catch (err) {
		return { kind: "text", text: errorMessage(err) };
	}
}

function skillPickerItems(
	hits: Awaited<ReturnType<typeof searchSkillCatalog>>,
	loaded: Array<{ name: string; source: string; catalogRef?: string }>,
	disabled: string[] = [],
): PickerItem[] {
	const off = new Set(disabled.map((name) => name.toLowerCase()));
	return hits.map((hit) => {
		const current = loaded.find((skill) => skillIsCatalogHit(skill, hit));
		let hint = "add";
		if (off.has(hit.name.toLowerCase())) hint = "off · enable";
		else if (current?.source === "user") hint = "on · remove";
		else if (current) hint = "on · disable";
		else if (hit.source === "bundled") hint = "add · bundled";
		else if (hit.source) hint = `add · ${hit.source}`;
		return { id: skillCatalogRef(hit), label: hit.name, hint };
	});
}

function integrationPickerItems(items: PublicIntegration[]): PickerItem[] {
	return items.map((item) => {
		let hint = "connect";
		if (item.connected) hint = "on · disconnect";
		else if (item.auth === "desktop") hint = "connect · figma desktop";
		else if (item.auth === "google" || item.auth === "microsoft") hint = "connect · oauth client";
		return { id: item.id, label: item.label, hint };
	});
}

function matchPublicIntegration(query: string): PublicIntegration | undefined {
	const items = listPublicIntegrations();
	const q = query.trim().toLowerCase();
	if (!q) return undefined;
	return (
		items.find((item) => item.id.toLowerCase() === q) ??
		items.find((item) => item.label.toLowerCase() === q) ??
		items.find(
			(item) => item.id.toLowerCase().startsWith(q) || item.label.toLowerCase().startsWith(q),
		)
	);
}

async function toggleIntegration(
	harness: HarnessRuntime,
	id: string,
): Promise<{ kind: "text"; text: string }> {
	const item = matchPublicIntegration(id);
	if (!item) return { kind: "text", text: `No integration ${JSON.stringify(id)}.` };
	if (item.connected) {
		removeConnection(item.id);
		await harness.reloadIntegrations();
		return { kind: "text", text: `Disconnected ${item.label}` };
	}
	try {
		await withOAuthLoopback(async ({ redirectUri, waitForCallback }) => {
			await connectMcp({ connectorId: item.id, redirectUri, waitForCallback });
		});
		await harness.reloadIntegrations();
		return { kind: "text", text: `Connected ${item.label}` };
	} catch (err) {
		return { kind: "text", text: errorMessage(err) };
	}
}

type SlashHandler = (harness: HarnessRuntime, arg: string, cmd: string) => Promise<SlashOutcome>;

async function handleIntegrations(harness: HarnessRuntime, arg: string): Promise<SlashOutcome> {
	if (!arg) {
		const items = listPublicIntegrations();
		return {
			kind: "picker",
			title: "Integrations",
			picker: "integration",
			items: integrationPickerItems(items),
		};
	}
	return toggleIntegration(harness, arg);
}

async function handleSkillFind(harness: HarnessRuntime, query: string): Promise<SlashOutcome> {
	const hits = query ? await searchSkillCatalog(query) : await browseSkillCatalog();
	const items = skillPickerItems(hits, harness.skills, harness.disabledSkills());
	if (items.length === 0) return { kind: "text", text: "No matches." };
	return {
		kind: "picker",
		title: query ? `Skills · ${query}` : "Skills",
		picker: "skill",
		items,
	};
}

async function handleSkillAdd(
	harness: HarnessRuntime,
	parsed: Extract<ReturnType<typeof parseSkillCommand>, { action: "add" }>,
): Promise<SlashOutcome> {
	const result = await harness.addSkill(parsed.source, {
		scope: parsed.scope,
		...(parsed.skill ? { skill: parsed.skill } : {}),
	});
	return { kind: "text", text: "error" in result ? result.error : `Loaded ${result.rel}` };
}

async function handleSkillRemove(
	harness: HarnessRuntime,
	parsed: Extract<ReturnType<typeof parseSkillCommand>, { action: "remove" }>,
): Promise<SlashOutcome> {
	const loaded = findSkillForCatalogId(harness.skills, parsed.name);
	const result = harness.removeSkill(parsed.name);
	const verb = loaded && loaded.source !== "user" ? "Disabled" : "Removed";
	return {
		kind: "text",
		text: result.ok ? `${verb} ${parsed.name}` : (result.error ?? "Could not remove."),
	};
}

async function handleSkillNew(
	harness: HarnessRuntime,
	parsed: Extract<ReturnType<typeof parseSkillCommand>, { action: "new" }>,
): Promise<SlashOutcome> {
	const result = await harness.authorSkill(parsed.name, parsed.brief);
	return { kind: "text", text: "error" in result ? result.error : `Wrote ${result.rel}` };
}

async function handleSkillSlash(
	harness: HarnessRuntime,
	arg: string,
	cmd: string,
): Promise<SlashOutcome> {
	const payload = cmd === "skill" ? arg : `${cmd.slice("skill ".length)} ${arg}`.trim();
	const parsed = parseSkillCommand(payload);
	if ("error" in parsed) return { kind: "text", text: parsed.error };
	if (parsed.action === "find") return handleSkillFind(harness, parsed.query);
	if (parsed.action === "add") return handleSkillAdd(harness, parsed);
	if (parsed.action === "remove") return handleSkillRemove(harness, parsed);
	if (parsed.action === "new") return handleSkillNew(harness, parsed);
	return { kind: "text", text: SKILL_COMMAND_USAGE };
}

async function handleModel(harness: HarnessRuntime, arg: string): Promise<SlashOutcome> {
	if (arg) {
		harness.setModel(arg);
		return { kind: "applied" };
	}
	const live = harness.hasApiKey
		? await loadLiveTargetNames(resolveOpenRouter(harness.config))
		: undefined;
	return {
		kind: "picker",
		title: "Model",
		picker: "model",
		items: modelPickerItems(harness.modelId, live),
	};
}

async function handleMode(harness: HarnessRuntime, arg: string): Promise<SlashOutcome> {
	if (arg) {
		const next = tryParseAgentMode(arg);
		if (!next) return { kind: "text", text: "Mode is ask, plan, or agent." };
		harness.setMode(next);
		return { kind: "applied" };
	}
	return {
		kind: "picker",
		title: "Mode",
		picker: "mode",
		items: AGENT_MODES.map((item) => ({ id: item, label: item })),
	};
}

async function handleMediaPicker(
	harness: HarnessRuntime,
	arg: string,
	kind: "image" | "video",
): Promise<SlashOutcome> {
	if (arg) return generateMediaOutcome(harness, kind, arg);
	const prefs = readMediaPrefs();
	const selected = kind === "image" ? prefs.imageModel : prefs.videoModel;
	return {
		kind: "picker",
		title: kind === "image" ? "Image model" : "Video model",
		picker: kind,
		items: mediaPickerItems(await mediaModels(harness, kind), selected),
	};
}

async function handleTranscribe(harness: HarnessRuntime, arg: string): Promise<SlashOutcome> {
	const models = await mediaModels(harness, "transcription");
	if (arg) {
		writeMediaPrefs({ transcribeModel: arg });
		return { kind: "applied" };
	}
	return {
		kind: "picker",
		title: "Speech model",
		picker: "transcribe",
		items: mediaPickerItems(models, readMediaPrefs().transcribeModel),
	};
}

async function handleResume(harness: HarnessRuntime, arg: string): Promise<SlashOutcome> {
	const list = await harness.store.list();
	if (list.length === 0) return { kind: "text", text: "No saved sessions." };
	if (arg) {
		const session = matchListedSession(list, arg) ?? (await harness.store.get(arg));
		if (!session) return { kind: "text", text: `No session matches ${arg}` };
		return { kind: "session", session };
	}
	return {
		kind: "picker",
		title: "Resume",
		picker: "resume",
		items: sessionPickerItems(list),
	};
}

function formatEvalResult(result: {
	name: string;
	ok: boolean;
	steps: Array<{ id: string; ok: boolean }>;
}): string {
	const mark = result.ok ? "ok" : "fail";
	const steps = result.steps.map((step) => `${step.id}:${step.ok ? "ok" : "fail"}`).join(" ");
	return `${result.name} ${mark} · ${steps}`;
}

async function handleEval(harness: HarnessRuntime, arg: string): Promise<SlashOutcome> {
	const evalsDir = `${harness.cwd}/${harness.config.evalsDir}`;
	if (!arg) {
		const names = await listEvalSuites(evalsDir);
		return { kind: "text", text: names.length ? names.join("\n") : "No eval suites." };
	}
	try {
		const result = await runNamedEval({
			config: harness.config,
			cwd: harness.cwd,
			name: arg,
			skills: harness.skills,
			chat: harness.chat,
			observability: harness.observability,
		});
		return { kind: "text", text: formatEvalResult(result) };
	} catch (err) {
		return { kind: "text", text: errorMessage(err) };
	}
}

function memoryState(harness: HarnessRuntime) {
	return {
		enabled: isMemoryEnabled({ configEnabled: harness.config.memory?.enabled }),
		facts: listFacts(harness.cwd),
	};
}

async function handleMemory(harness: HarnessRuntime, arg: string): Promise<SlashOutcome> {
	const body = arg.trim();
	if (!body) return { kind: "text", text: formatMemoryList(memoryState(harness)) };
	if (body === "on" || body === "off") {
		writeMemoryPrefs({ enabled: body === "on" });
		return { kind: "text", text: formatMemoryList(memoryState(harness)) };
	}
	const [action, ...rest] = body.split(/\s+/);
	const target = rest.join(" ").trim();
	if ((action === "delete" || action === "pin") && !target) {
		return { kind: "text", text: `/memory ${action} <n>` };
	}
	if (action === "delete") {
		const fact = matchFact(listFacts(harness.cwd), target);
		if (!fact) return { kind: "text", text: `No memory matches ${target}.` };
		deleteFact(harness.cwd, fact.id);
		const unpinned = unpinFact(harness.cwd, fact, harness.config.instructionsFile);
		if ("error" in unpinned) return { kind: "text", text: unpinned.error };
		return { kind: "text", text: `Deleted ${fact.text}` };
	}
	if (action === "pin") {
		const fact = matchFact(listFacts(harness.cwd), target);
		if (!fact) return { kind: "text", text: `No memory matches ${target}.` };
		const pinned = pinFact(harness.cwd, fact, harness.config.instructionsFile);
		if ("error" in pinned) return { kind: "text", text: pinned.error };
		return { kind: "text", text: `Pinned to ${pinned.path}` };
	}
	return { kind: "text", text: "/memory on · /memory off · /memory delete 1 · /memory pin 1" };
}

async function handleSettings(harness: HarnessRuntime, arg: string): Promise<SlashOutcome> {
	const body = arg.trim();
	if (!body || body === "key") {
		const hint = harness.hasApiKey
			? `Key on this machine · ${maskSecret(process.env.OPENROUTER_API_KEY ?? "")}`
			: "No key on this machine.";
		return { kind: "text", text: `${hint}\n/settings key <token>` };
	}
	const token = body.startsWith("key ") ? body.slice(4).trim() : body;
	if (!token) return { kind: "text", text: "/settings key <token>" };
	writeOpenRouterKey(token);
	harness.setApiKey(token);
	return { kind: "text", text: `Key saved · ${maskSecret(token)}` };
}

const SLASH_HANDLERS: Record<string, SlashHandler> = {
	help: async () => ({ kind: "text", text: SLASH_HELP }),
	skills: async (harness) => ({ kind: "text", text: formatSkillList(harness.skills) }),
	integrations: (harness, arg) => handleIntegrations(harness, arg),
	integration: (harness, arg) => handleIntegrations(harness, arg),
	skill: handleSkillSlash,
	"skill add": handleSkillSlash,
	"skill find": handleSkillSlash,
	"skill new": handleSkillSlash,
	"skill remove": handleSkillSlash,
	clear: async (harness) => {
		harness.setSession(undefined);
		return { kind: "clear" };
	},
	model: handleModel,
	mode: handleMode,
	compact: async (harness) => {
		const ok = await harness.compact();
		return { kind: "text", text: ok ? "Compacted earlier turns." : "Nothing to compact." };
	},
	image: (harness, arg) => handleMediaPicker(harness, arg, "image"),
	video: (harness, arg) => handleMediaPicker(harness, arg, "video"),
	transcribe: handleTranscribe,
	resume: handleResume,
	eval: handleEval,
	memory: handleMemory,
	settings: handleSettings,
	exit: async () => ({ kind: "exit" }),
	quit: async () => ({ kind: "exit" }),
};

export async function dispatchSlash(harness: HarnessRuntime, raw: string): Promise<SlashOutcome> {
	const { cmd, arg } = parseSlashLine(raw);
	const handler = SLASH_HANDLERS[cmd];
	if (!handler) return { kind: "text", text: `Unknown command /${cmd}. /help for the list.` };
	return handler(harness, arg, cmd);
}

const MEDIA_PICKER_PREFS: Partial<Record<SlashPickerKind, (id: string) => void>> = {
	image: (id) => writeMediaPrefs({ imageModel: id }),
	video: (id) => writeMediaPrefs({ videoModel: id }),
	transcribe: (id) => writeMediaPrefs({ transcribeModel: id }),
};

async function applySkillPicker(
	harness: HarnessRuntime,
	id: string,
): Promise<{ kind: "text"; text: string }> {
	const name = skillNameFromCatalogId(id);
	if (isBundledCatalogId(id) && harness.disabledSkills().includes(name.toLowerCase())) {
		harness.enableSkill(name);
		return { kind: "text", text: `Enabled ${name}` };
	}
	const loaded = findSkillForCatalogId(harness.skills, id);
	if (loaded) {
		const result = harness.removeSkill(loaded.catalogRef ?? loaded.name);
		const verb = loaded.source === "user" ? "Removed" : "Disabled";
		return {
			kind: "text",
			text: result.ok ? `${verb} ${loaded.name}` : (result.error ?? "Could not remove."),
		};
	}
	const result = await harness.addSkill(id);
	return { kind: "text", text: "error" in result ? result.error : `Loaded ${result.rel}` };
}

export async function applyPickerChoice(
	harness: HarnessRuntime,
	picker: SlashPickerKind,
	id: string,
): Promise<
	{ kind: "applied" } | { kind: "text"; text: string } | { kind: "session-id"; id: string }
> {
	if (picker === "model") {
		harness.setModel(id);
		return { kind: "applied" };
	}
	if (picker === "mode") {
		const next = tryParseAgentMode(id);
		if (!next) return { kind: "text", text: "Mode is ask, plan, or agent." };
		harness.setMode(next);
		return { kind: "applied" };
	}
	const writePref = MEDIA_PICKER_PREFS[picker];
	if (writePref) {
		writePref(id);
		return { kind: "applied" };
	}
	if (picker === "skill") return applySkillPicker(harness, id);
	if (picker === "integration") {
		return toggleIntegration(harness, id);
	}
	return { kind: "session-id", id };
}

export async function runSlashLine(harness: HarnessRuntime, raw: string): Promise<SlashOutcome> {
	const resolved = resolveSlashSubmit(raw);
	if (resolved?.action === "hold") return { kind: "hold" };
	if (resolved?.action === "complete") return { kind: "incomplete", draft: resolved.line };
	return dispatchSlash(harness, resolved?.action === "send" ? resolved.line : raw);
}
