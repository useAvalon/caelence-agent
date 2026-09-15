import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SKILL_NAME = /^[a-z][a-z0-9-]*$/;

export function normalizeSkillName(raw: string): string {
	return raw.trim().toLowerCase();
}

export function parseSkillNewArgs(
	arg: string,
): { name: string; brief: string } | { error: string } {
	const tokens = arg.trim().split(/\s+/);
	if (tokens[0]?.toLowerCase() === "new") tokens.shift();
	const name = tokens.shift() ?? "";
	const brief = tokens.join(" ").trim();
	if (!name) {
		return { error: "/skill new <name> <what it should do>" };
	}
	if (!SKILL_NAME.test(normalizeSkillName(name))) {
		return { error: "Name is lowercase letters, numbers, and hyphens." };
	}
	if (brief.length < 8) {
		return { error: "Add a brief after the name so the agent can write the skill." };
	}
	return { name: normalizeSkillName(name), brief };
}

export function unwrapMarkdownFence(text: string): string {
	const trimmed = text.trim();
	const fenced = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/i.exec(trimmed);
	return (fenced?.[1] ?? trimmed).trim();
}

export function applySkillName(markdown: string, name: string): string {
	if (!markdown.startsWith("---")) {
		return `---\nname: ${name}\ndescription: >-\n  ${name}\n---\n\n${markdown}`;
	}
	return markdown.replace(/^---\n[\s\S]*?\n---/, (block) => {
		if (/^name:/m.test(block)) return block.replace(/^name:\s*.*$/m, `name: ${name}`);
		return block.replace(/^---\n/, `---\nname: ${name}\n`);
	});
}

export function createHostSkill(input: { skillsDir: string; name: string; markdown: string }): {
	rel: string;
	created: boolean;
	reason?: string;
} {
	const name = normalizeSkillName(input.name);
	if (!SKILL_NAME.test(name)) {
		return {
			rel: "",
			created: false,
			reason: "Name is lowercase letters, numbers, and hyphens.",
		};
	}
	const markdown = applySkillName(unwrapMarkdownFence(input.markdown), name);
	if (markdown.length < 80) {
		return { rel: "", created: false, reason: "Generated skill was empty." };
	}
	const rel = `${name}/SKILL.md`;
	const file = join(input.skillsDir, rel);
	if (existsSync(file)) {
		return { rel, created: false, reason: "Skill already exists." };
	}
	mkdirSync(join(input.skillsDir, name), { recursive: true });
	writeFileSync(file, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
	return { rel, created: true };
}
