import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	bundledSkillsDir,
	isBundledCatalogDir,
	loadMergedSkills,
	loadSkills,
	mergeSkills,
	parseSkillMarkdown,
	resolveHostSkillDirs,
	skillCatalogPrompt,
	stripFrontmatter,
} from "../skills/loader.ts";

const minimal = join(import.meta.dir, "../../examples/minimal");

describe("skill loader", () => {
	test("strips yaml frontmatter and folded description", () => {
		const md = `---
name: hello
description: >-
  Sample skill used by harness tests. Load when the user mentions hello.
---

# Hello

Body here.
`;
		const { attrs, body } = stripFrontmatter(md);
		expect(attrs.name).toBe("hello");
		expect(attrs.description).toContain("Sample skill");
		expect(body.startsWith("# Hello")).toBe(true);
	});

	test("loads example host skills", () => {
		const skills = loadSkills(join(minimal, "skills"));
		expect(skills.length).toBe(1);
		expect(skills[0]?.name).toBe("hello");
		expect(skills[0]?.relPath).toBe("hello/SKILL.md");
		expect(skills[0]?.body).toContain("short greeting");
	});

	test("does not load nested SKILL.md files as extra skills", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-nested-skill-"));
		try {
			mkdirSync(join(cwd, "frontend-design", "xlsx"), { recursive: true });
			writeFileSync(
				join(cwd, "frontend-design", "SKILL.md"),
				"---\nname: frontend-design\n---\n\n# UI\n",
			);
			writeFileSync(
				join(cwd, "frontend-design", "xlsx", "SKILL.md"),
				"---\nname: xlsx\n---\n\n# Sheets\n",
			);
			const skills = loadSkills(cwd);
			expect(skills.map((skill) => skill.name)).toEqual(["frontend-design"]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("parseSkillMarkdown falls back to folder name", () => {
		const skill = parseSkillMarkdown("# bare", "/tmp/skills/foo/SKILL.md", "/tmp/skills");
		expect(skill.name).toBe("foo");
	});

	test("loads bundled copy skills from the package catalog", () => {
		const bundled = loadSkills(bundledSkillsDir());
		const names = bundled.map((s) => s.name);
		expect(names).toContain("copywriting");
		expect(names).toContain("copy-rmbc");
		expect(names).toContain("copy-harry-dry");
		expect(names).toContain("copy-editor");
		expect(names).toContain("impeccable");
		expect(bundled.find((s) => s.name === "copywriting")?.body).not.toContain("Caelence product");
		expect(bundled.find((s) => s.name === "copywriting")?.body).toContain("impeccable");
		expect(bundled.find((s) => s.name === "impeccable")?.body).toContain("design.md");
		expect(bundled.find((s) => s.name === "impeccable")?.body).not.toContain("#9BB35B");
	});

	test("does not auto-load the bundled catalog", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-sk-empty-"));
		try {
			const merged = loadMergedSkills(cwd);
			expect(merged.map((s) => s.name)).not.toContain("copywriting");
			expect(merged.map((s) => s.name)).not.toContain("impeccable");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("skips the package catalog when cwd/skills is that folder", () => {
		const root = join(import.meta.dir, "../..");
		expect(isBundledCatalogDir(bundledSkillsDir())).toBe(true);
		const dirs = resolveHostSkillDirs(root, "skills");
		expect(dirs.some((dir) => isBundledCatalogDir(dir))).toBe(false);
		const merged = loadMergedSkills(dirs);
		expect(merged.map((skill) => skill.name)).not.toContain("copywriting");
		expect(merged.map((skill) => skill.name)).not.toContain("impeccable");
	});

	test("host skills override user skills of the same name", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-sk-"));
		try {
			const user = join(cwd, "user");
			const host = join(cwd, "host");
			mkdirSync(join(user, "copywriting"), { recursive: true });
			mkdirSync(join(host, "copywriting"), { recursive: true });
			writeFileSync(
				join(user, "copywriting", "SKILL.md"),
				"---\nname: copywriting\ndescription: user\n---\n\n# User\n",
			);
			writeFileSync(
				join(host, "copywriting", "SKILL.md"),
				"---\nname: copywriting\ndescription: host override\n---\n\n# Host\n",
			);
			const merged = loadMergedSkills(host, user);
			const copy = merged.find((s) => s.name === "copywriting");
			expect(copy?.source).toBe("host");
			expect(copy?.body).toContain("# Host");
			expect(merged.find((s) => s.name === "copy-rmbc")).toBeUndefined();
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("keeps user skills with the same YAML name when catalog refs differ", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-sk-dup-"));
		try {
			const user = join(cwd, "user");
			mkdirSync(join(user, "acme-pack-frontend-design"), { recursive: true });
			mkdirSync(join(user, "other-ui-frontend-design"), { recursive: true });
			writeFileSync(
				join(user, "acme-pack-frontend-design", "SKILL.md"),
				"---\nname: frontend-design\n---\n\n# Acme\n",
			);
			writeFileSync(
				join(user, "acme-pack-frontend-design", ".catalog-ref"),
				"acme/pack/frontend-design\n",
			);
			writeFileSync(
				join(user, "other-ui-frontend-design", "SKILL.md"),
				"---\nname: frontend-design\n---\n\n# Other\n",
			);
			writeFileSync(
				join(user, "other-ui-frontend-design", ".catalog-ref"),
				"other/ui/frontend-design\n",
			);
			const merged = loadMergedSkills(join(cwd, "host"), user);
			const dupes = merged.filter((skill) => skill.name === "frontend-design");
			expect(dupes).toHaveLength(2);
			expect(skillCatalogPrompt(dupes)).toContain("acme/pack/frontend-design");
			expect(skillCatalogPrompt(dupes)).toContain("other/ui/frontend-design");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("skill catalog lists names only", () => {
		const catalog = skillCatalogPrompt([
			{
				name: "copywriting",
				description: "Routes copy work through a long folded description that must not leak.",
				body: "# body",
				path: "/tmp/copywriting/SKILL.md",
				relPath: "copywriting/SKILL.md",
				source: "host",
			},
		]);
		expect(catalog).toContain("- copywriting (host)");
		expect(catalog).not.toContain("Routes copy");
	});

	test("mergeSkills last writer wins", () => {
		const a = parseSkillMarkdown("---\nname: x\n---\nA", "/b/x/SKILL.md", "/b");
		const b = parseSkillMarkdown("---\nname: x\n---\nB", "/h/x/SKILL.md", "/h");
		const merged = mergeSkills([{ ...a, source: "bundled" }], [{ ...b, source: "host" }]);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.body).toBe("B");
		expect(merged[0]?.source).toBe("host");
	});
});
