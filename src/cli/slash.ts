export interface SlashCommand {
	name: string;
	hint: string;
	arg?: boolean;
	/** Placeholder shown after the name, e.g. `[name]`. */
	slot?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
	{ name: "help", hint: "this list" },
	{ name: "skills", hint: "loaded skills" },
	{ name: "skill add", hint: "install a bundled or skills.sh skill", arg: true },
	{ name: "skill find", hint: "browse bundled and skills.sh", arg: true, slot: "[query]" },
	{ name: "skill new", hint: "author a project skill", arg: true },
	{ name: "skill remove", hint: "remove a user skill", arg: true },
	{ name: "integrations", hint: "connect MCP servers" },
	{ name: "eval", hint: "run an eval suite", arg: true, slot: "[name]" },
	{ name: "clear", hint: "new session" },
	{ name: "resume", hint: "pick a session by title" },
	{ name: "model", hint: "pick a model" },
	{ name: "mode", hint: "ask, plan, or agent" },
	{ name: "compact", hint: "summarize earlier turns" },
	{ name: "memory", hint: "remember across chats", arg: true },
	{ name: "image", hint: "generate an image", arg: true, slot: "[prompt]" },
	{ name: "video", hint: "generate a clip", arg: true, slot: "[prompt]" },
	{ name: "transcribe", hint: "speech to text model" },
	{ name: "settings", hint: "OpenRouter API key", arg: true },
	{ name: "exit", hint: "quit" },
];

export function filterSlashCommands(raw: string): SlashCommand[] {
	const text = raw.startsWith("/") ? raw.slice(1) : raw;
	const body = text.trimStart().toLowerCase();
	if (!body) return SLASH_COMMANDS;
	return SLASH_COMMANDS.filter(
		(item) => item.name.startsWith(body) || body.startsWith(`${item.name} `),
	);
}

export function parseSlashLine(raw: string): { cmd: string; arg: string } {
	const body = raw.replace(/^\//, "").trim();
	const named = [...SLASH_COMMANDS].sort((a, b) => b.name.length - a.name.length);
	const match = named.find((item) => body === item.name || body.startsWith(`${item.name} `));
	if (match) return { cmd: match.name, arg: body.slice(match.name.length).trim() };
	const [cmd, ...rest] = body.split(/\s+/);
	return { cmd: cmd ?? "", arg: rest.join(" ") };
}

export function completeSlashCommand(command: SlashCommand): string {
	return command.arg ? `/${command.name} ` : `/${command.name}`;
}

export function formatSlashCommand(command: SlashCommand): string {
	return command.slot ? `/${command.name} ${command.slot}` : `/${command.name}`;
}

/** Empty submit opens a picker instead of requiring an argument. */
export const PICKS_WHEN_EMPTY = new Set([
	"model",
	"mode",
	"resume",
	"image",
	"video",
	"transcribe",
	"integrations",
	"skill find",
]);

/** Empty submit stays in the composer until the argument is typed. */
export const REQUIRES_ARG = new Set(["skill add", "skill new", "skill remove"]);

export type SlashSubmit =
	| { action: "send"; line: string }
	| { action: "complete"; line: string }
	| { action: "hold" };

function acceptSlashChoice(command: SlashCommand): SlashSubmit {
	if (REQUIRES_ARG.has(command.name)) {
		return { action: "complete", line: completeSlashCommand(command) };
	}
	return { action: "send", line: `/${command.name}` };
}

/**
 * Enter on a slash line. A highlighted menu item is accepted even when the
 * typed prefix is still ambiguous. Unique prefixes complete. Unknown prefixes
 * are not sent as chat.
 */
export function resolveSlashSubmit(raw: string, selected?: SlashCommand): SlashSubmit | null {
	const trimmed = raw.trim();
	if (!trimmed.startsWith("/") && !isHelpAlias(trimmed)) return null;
	if (isHelpAlias(trimmed)) return { action: "send", line: "/help" };

	const { cmd, arg } = parseSlashLine(trimmed);
	const typed = trimmed.replace(/^\//, "").trim().toLowerCase();
	const exact = SLASH_COMMANDS.find((item) => item.name === cmd);
	if (exact && typed && (typed === exact.name || typed.startsWith(`${exact.name} `))) {
		if (!arg && REQUIRES_ARG.has(exact.name)) {
			return { action: "complete", line: completeSlashCommand(exact) };
		}
		if (!arg && PICKS_WHEN_EMPTY.has(exact.name)) return { action: "send", line: trimmed };
		return { action: "send", line: trimmed };
	}

	const matches = filterSlashCommands(trimmed);
	if (selected && matches.some((item) => item.name === selected.name)) {
		return acceptSlashChoice(selected);
	}
	if (matches.length === 1 && matches[0]) {
		return { action: "complete", line: completeSlashCommand(matches[0]) };
	}
	return { action: "hold" };
}

export function draftAfterPicker(kind: string): string | undefined {
	if (kind === "image") return "/image ";
	if (kind === "video") return "/video ";
	return undefined;
}

export function isHelpAlias(text: string): boolean {
	const value = text.trim().toLowerCase();
	return value === "help" || value === "--help" || value === "-h";
}

export function formatSkillList(skills: Array<{ name: string; source: string }>): string {
	if (skills.length === 0) {
		return "No skills loaded. /skill add copywriting or /skill find";
	}
	return skills
		.map((skill) => `${skill.name}  ${skill.source === "host" ? "project" : skill.source}`)
		.join("\n");
}

export function formatIntegrationList(
	items: Array<{ label: string; connected: boolean; auth?: string }>,
): string {
	if (items.length === 0) return "No integrations.";
	return items
		.map((item) => {
			const state = item.connected ? "on" : "off";
			return `${item.label}  ${state}`;
		})
		.join("\n");
}

export const SLASH_HELP = SLASH_COMMANDS.map(
	(item) => `${formatSlashCommand(item)} · ${item.hint}`,
).join("\n");
