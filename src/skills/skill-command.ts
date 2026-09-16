import { parseSkillNewArgs } from "./create-skill.ts";

export const SKILL_FIND_HINT = "Empty find lists bundled skills and popular skills.sh hits.";

export const SKILL_COMMAND_USAGE = [
	"/skill find [query]",
	"/skill add <name or owner/repo@skill>",
	"/skill add --project <name or owner/repo@skill>",
	"/skill new <name> <what it should do>",
	"/skill remove <name>",
].join("\n");

export type SkillCommand =
	| { action: "find"; query: string }
	| { action: "add"; source: string; skill?: string; scope: "user" | "project" }
	| { action: "new"; name: string; brief: string }
	| { action: "remove"; name: string };

export function parseSkillCommand(raw: string): SkillCommand | { error: string } {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	const verb = tokens[0]?.toLowerCase();
	if (!verb) return { error: SKILL_COMMAND_USAGE };

	if (verb === "find" || verb === "search") {
		return { action: "find", query: tokens.slice(1).join(" ").trim() };
	}

	if (verb === "add" || verb === "install") {
		let scope: "user" | "project" = "user";
		const rest: string[] = [];
		for (const token of tokens.slice(1)) {
			if (token === "--project" || token === "-p") scope = "project";
			else if (token === "--user" || token === "-g") scope = "user";
			else rest.push(token);
		}
		const source = rest[0];
		if (!source) return { error: "/skill add <name or owner/repo@skill>" };
		const skill = rest[1];
		return { action: "add", source, scope, ...(skill ? { skill } : {}) };
	}

	if (verb === "remove" || verb === "rm") {
		const name = tokens[1];
		if (!name) return { error: "/skill remove <name>" };
		return { action: "remove", name };
	}

	if (verb === "new") {
		const parsed = parseSkillNewArgs(raw);
		if ("error" in parsed) return parsed;
		return { action: "new", name: parsed.name, brief: parsed.brief };
	}

	return { error: SKILL_COMMAND_USAGE };
}
