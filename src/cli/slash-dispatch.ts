import { resolveOpenRouter } from "../config.ts";
import { AGENT_MODES, tryParseAgentMode } from "../core/mode.ts";
import type { Session } from "../core/session.ts";
import { maskSecret, writeOpenRouterKey } from "../desktop/secrets.ts";
import { listEvalSuites, runNamedEval } from "../evals/runner.ts";
import { type GeneratedMedia, generateImage, generateVideo } from "../media/openrouter-generate.ts";
import { readMediaPrefs, writeMediaPrefs } from "../media/prefs.ts";
import type { HarnessRuntime } from "../runtime.ts";
import { parseSkillCommand, SKILL_COMMAND_USAGE } from "../skills/skill-command.ts";
import { type MediaModelOption, mediaModelLabel, mediaPickerItems } from "./media-models.ts";
import { modelPickerItems } from "./models.ts";
import { loadLiveTargetNames } from "./openrouter-live.ts";
import { loadModalityModels, type MediaModality } from "./openrouter-modality.ts";
import { matchListedSession, type PickerItem, sessionPickerItems } from "./picker.ts";
import { formatSkillList, parseSlashLine, resolveSlashSubmit, SLASH_HELP } from "./slash.ts";

export type SlashPickerKind = "model" | "mode" | "resume" | "image" | "video" | "transcribe";

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
		return { kind: "text", text: err instanceof Error ? err.message : String(err) };
	}
}

export async function dispatchSlash(harness: HarnessRuntime, raw: string): Promise<SlashOutcome> {
	const { cmd, arg } = parseSlashLine(raw);
	switch (cmd) {
		case "help":
			return { kind: "text", text: SLASH_HELP };
		case "skills":
			return { kind: "text", text: formatSkillList(harness.skills) };
		case "skill":
		case "skill add":
		case "skill find":
		case "skill new":
		case "skill remove": {
			const payload = cmd === "skill" ? arg : `${cmd.slice("skill ".length)} ${arg}`.trim();
			const parsed = parseSkillCommand(payload);
			if ("error" in parsed) return { kind: "text", text: parsed.error };
			if (parsed.action === "find") {
				return { kind: "text", text: await harness.findSkills(parsed.query) };
			}
			if (parsed.action === "add") {
				const result = await harness.addSkill(parsed.source, {
					scope: parsed.scope,
					...(parsed.skill ? { skill: parsed.skill } : {}),
				});
				return { kind: "text", text: "error" in result ? result.error : `Loaded ${result.rel}` };
			}
			if (parsed.action === "remove") {
				const result = harness.removeSkill(parsed.name);
				return {
					kind: "text",
					text: result.ok ? `Removed ${parsed.name}` : (result.error ?? "Could not remove."),
				};
			}
			if (parsed.action === "new") {
				const result = await harness.authorSkill(parsed.name, parsed.brief);
				return { kind: "text", text: "error" in result ? result.error : `Wrote ${result.rel}` };
			}
			return { kind: "text", text: SKILL_COMMAND_USAGE };
		}
		case "clear":
			harness.setSession(undefined);
			return { kind: "clear" };
		case "model": {
			if (arg) {
				harness.setModel(arg);
				return { kind: "applied" };
			}
			const live = harness.hasApiKey
				? await loadLiveTargetNames(resolveOpenRouter(harness.config))
				: undefined;
			const items = modelPickerItems(harness.modelId, live);
			return {
				kind: "picker",
				title: "Model",
				picker: "model",
				items,
			};
		}
		case "mode": {
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
		case "compact": {
			const ok = await harness.compact();
			return { kind: "text", text: ok ? "Compacted earlier turns." : "Nothing to compact." };
		}
		case "image": {
			if (arg) return generateMediaOutcome(harness, "image", arg);
			return {
				kind: "picker",
				title: "Image model",
				picker: "image",
				items: mediaPickerItems(await mediaModels(harness, "image"), readMediaPrefs().imageModel),
			};
		}
		case "video": {
			if (arg) return generateMediaOutcome(harness, "video", arg);
			return {
				kind: "picker",
				title: "Video model",
				picker: "video",
				items: mediaPickerItems(await mediaModels(harness, "video"), readMediaPrefs().videoModel),
			};
		}
		case "transcribe": {
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
		case "resume": {
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
		case "eval": {
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
				return {
					kind: "text",
					text: `${result.name} ${result.ok ? "ok" : "fail"} · ${result.steps.map((s) => `${s.id}:${s.ok ? "ok" : "fail"}`).join(" ")}`,
				};
			} catch (err) {
				return { kind: "text", text: err instanceof Error ? err.message : String(err) };
			}
		}
		case "settings": {
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
		case "exit":
		case "quit":
			return { kind: "exit" };
		default:
			return { kind: "text", text: `Unknown command /${cmd}. /help for the list.` };
	}
}

export function applyPickerChoice(
	harness: HarnessRuntime,
	picker: SlashPickerKind,
	id: string,
): { kind: "applied" } | { kind: "text"; text: string } | { kind: "session-id"; id: string } {
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
	if (picker === "image") {
		writeMediaPrefs({ imageModel: id });
		return { kind: "applied" };
	}
	if (picker === "video") {
		writeMediaPrefs({ videoModel: id });
		return { kind: "applied" };
	}
	if (picker === "transcribe") {
		writeMediaPrefs({ transcribeModel: id });
		return { kind: "applied" };
	}
	return { kind: "session-id", id };
}

export async function runSlashLine(harness: HarnessRuntime, raw: string): Promise<SlashOutcome> {
	const resolved = resolveSlashSubmit(raw);
	if (resolved?.action === "hold") return { kind: "hold" };
	if (resolved?.action === "complete") return { kind: "incomplete", draft: resolved.line };
	return dispatchSlash(harness, resolved?.action === "send" ? resolved.line : raw);
}
