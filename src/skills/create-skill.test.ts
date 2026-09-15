import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorSkillMarkdown } from "./author-skill.ts";
import {
	applySkillName,
	createHostSkill,
	parseSkillNewArgs,
	unwrapMarkdownFence,
} from "./create-skill.ts";
import { loadMergedSkills, resolveHostSkillDirs } from "./loader.ts";

const SAMPLE = `---
name: review-ui
description: >-
  Review product UI for contrast and spacing.
---

# Review UI

Use when the user asks to critique a product screen.
Check contrast, type, and spacing against the host design.md.
Do not invent metrics.
`;

describe("parseSkillNewArgs", () => {
	test("requires a brief after the name", () => {
		expect(parseSkillNewArgs("new test")).toEqual({
			error: "Add a brief after the name so the agent can write the skill.",
		});
		expect(parseSkillNewArgs("new review-pr Flag leaked secrets in diffs")).toEqual({
			name: "review-pr",
			brief: "Flag leaked secrets in diffs",
		});
	});
});

describe("createHostSkill", () => {
	test("writes supplied markdown and refuses a second copy", async () => {
		const dir = await mkdtemp(join(tmpdir(), "harness-new-skill-"));
		try {
			expect(createHostSkill({ skillsDir: dir, name: "review-ui", markdown: "" }).created).toBe(
				false,
			);
			const first = createHostSkill({ skillsDir: dir, name: "Review-UI", markdown: SAMPLE });
			expect(first.created).toBe(true);
			expect(first.rel).toBe("review-ui/SKILL.md");
			const body = await readFile(join(dir, first.rel), "utf8");
			expect(body).toContain("Review product UI");
			expect(body).toContain("name: review-ui");
			const second = createHostSkill({ skillsDir: dir, name: "review-ui", markdown: SAMPLE });
			expect(second.created).toBe(false);
			expect(createHostSkill({ skillsDir: dir, name: "Bad Name", markdown: SAMPLE }).created).toBe(
				false,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("strips a markdown fence and pins the name", () => {
		const fenced = unwrapMarkdownFence("```markdown\n# Hello\n\nBody here.\n```");
		expect(fenced.startsWith("# Hello")).toBe(true);
		expect(
			applySkillName("---\nname: other\ndescription: x\n---\n\n# Other\n\nDo the work.\n", "mine"),
		).toContain("name: mine");
	});
});

describe("authorSkillMarkdown", () => {
	test("uses the chat result and rejects an empty body", async () => {
		const ok = await authorSkillMarkdown({
			name: "secrets",
			brief: "Flag committed .env files",
			model: "fake",
			chat: async () => SAMPLE.replace("review-ui", "secrets"),
		});
		expect("markdown" in ok && ok.markdown).toContain("name: secrets");
		const empty = await authorSkillMarkdown({
			name: "secrets",
			brief: "Flag committed .env files",
			model: "fake",
			chat: async () => "ok",
		});
		expect("error" in empty).toBe(true);
	});
});

describe("host skill dirs", () => {
	test("reads Cursor and Claude Code folders plus skills/", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-skill-dirs-"));
		try {
			mkdirSync(join(cwd, ".claude", "skills", "from-claude"), { recursive: true });
			writeFileSync(
				join(cwd, ".claude", "skills", "from-claude", "SKILL.md"),
				"---\nname: from-claude\ndescription: claude\n---\n\n# Claude\n",
			);
			const dirs = resolveHostSkillDirs(cwd, "skills");
			expect(dirs.some((dir) => dir.endsWith(".claude/skills"))).toBe(true);
			const merged = loadMergedSkills(dirs);
			expect(merged.some((skill) => skill.name === "from-claude")).toBe(true);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
