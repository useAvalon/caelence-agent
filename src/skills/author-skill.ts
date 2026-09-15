import type { ChatFn } from "../evals/runner.ts";
import { applySkillName, unwrapMarkdownFence } from "./create-skill.ts";
import { parseSkillMarkdown } from "./loader.ts";

export const SKILL_AUTHOR_SYSTEM = [
	"Write one SKILL.md for a coding agent. Output only the file. No fence.",
	"This is a portable Agent Skill (YAML frontmatter + markdown). It is not Cursor-only.",
	"The same file works in this harness, Cursor (.cursor/skills), and Claude Code (.claude/skills).",
	"",
	"Format:",
	"---",
	"name: kebab-case",
	"description: >-",
	"  One paragraph: what it does and when to load it. Third person. No invented metrics.",
	"---",
	"",
	"# Title",
	"",
	"When to use this skill.",
	"What to do, in concrete steps.",
	"What not to do.",
	"",
	"Honor the user's brief. Do not invent product facts, testimonials, or numbers.",
	"Sentence case headings. No terminal period on headings.",
].join("\n");

export async function authorSkillMarkdown(input: {
	name: string;
	brief: string;
	chat: ChatFn;
	model: string;
}): Promise<{ markdown: string } | { error: string }> {
	let raw: string;
	try {
		raw = await input.chat({
			system: SKILL_AUTHOR_SYSTEM,
			user: [`Name: ${input.name}`, `What the skill should do:`, input.brief].join("\n"),
			model: input.model,
		});
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
	const markdown = applySkillName(unwrapMarkdownFence(raw), input.name);
	const parsed = parseSkillMarkdown(markdown, `${input.name}/SKILL.md`, ".");
	if (parsed.body.trim().length < 40) {
		return { error: "The model did not write a usable skill. Try a more specific brief." };
	}
	return { markdown };
}
