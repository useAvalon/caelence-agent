import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMergedSkills } from "./loader.ts";
import {
	bundledRegistryHits,
	formatRegistryHits,
	installBundledSkills,
	installSkillFromSource,
	parseBundledSkillRef,
	parseSkillSource,
	removeSkillFromRoots,
	searchSkillCatalog,
	searchSkills,
	searchSkillsSh,
} from "./registry.ts";
import { parseSkillCommand } from "./skill-command.ts";

describe("parseSkillSource", () => {
	test("accepts owner/repo@skill and skills.sh urls", () => {
		expect(parseSkillSource("anthropics/skills@frontend-design")).toEqual({
			owner: "anthropics",
			repo: "skills",
			skill: "frontend-design",
			ref: "HEAD",
		});
		expect(parseSkillSource("https://skills.sh/anthropics/skills/frontend-design")).toMatchObject({
			owner: "anthropics",
			repo: "skills",
			skill: "frontend-design",
		});
	});
});

describe("parseSkillCommand", () => {
	test("routes find, add, and new", () => {
		expect(parseSkillCommand("find frontend")).toEqual({ action: "find", query: "frontend" });
		expect(parseSkillCommand("add copywriting")).toEqual({
			action: "add",
			source: "copywriting",
			scope: "user",
		});
		expect(parseSkillCommand("add anthropics/skills@frontend-design")).toEqual({
			action: "add",
			source: "anthropics/skills@frontend-design",
			scope: "user",
		});
		expect(parseSkillCommand("find")).toEqual({ action: "find", query: "" });
		expect(parseSkillCommand("add --project acme/pack hello")).toEqual({
			action: "add",
			source: "acme/pack",
			skill: "hello",
			scope: "project",
		});
		expect(parseSkillCommand("new")).toHaveProperty("error");
	});
});

describe("searchSkillsSh", () => {
	test("maps the public search payload", async () => {
		const hits = await searchSkillsSh(
			"frontend-design",
			async () =>
				new Response(
					JSON.stringify({
						skills: [
							{
								id: "anthropics/skills/frontend-design",
								name: "frontend-design",
								source: "anthropics/skills",
								installs: 10,
							},
						],
					}),
				),
		);
		expect(hits[0]).toEqual({
			id: "anthropics/skills/frontend-design",
			name: "frontend-design",
			source: "anthropics/skills",
			installs: 10,
		});
		expect(formatRegistryHits(hits)).toBe("anthropics/skills@frontend-design  10");
	});
});

describe("installSkillFromSource", () => {
	test("downloads a GitHub skill into the user store", async () => {
		const dest = await mkdtemp(join(tmpdir(), "harness-user-skills-"));
		try {
			const result = await installSkillFromSource({
				source: "acme/pack@hello",
				destRoot: dest,
				fetchFn: async (url) => {
					if (url.includes("/git/trees/")) {
						return Response.json({
							tree: [
								{ path: "skills/hello/SKILL.md", type: "blob" },
								{ path: "skills/hello/references/note.md", type: "blob" },
							],
						});
					}
					if (url.endsWith("skills/hello/SKILL.md")) {
						return new Response(
							"---\nname: hello\ndescription: demo\n---\n\n# Hello\n\nDo the work.\n",
						);
					}
					if (url.endsWith("note.md")) return new Response("# note\n");
					return new Response("missing", { status: 404 });
				},
			});
			expect(result).toEqual({ name: "hello", rel: "hello/SKILL.md" });
			const body = await readFile(join(dest, "hello", "SKILL.md"), "utf8");
			expect(body).toContain("# Hello");
			expect(await readFile(join(dest, "hello", ".catalog-ref"), "utf8")).toBe("acme/pack@hello\n");
		} finally {
			await rm(dest, { recursive: true, force: true });
		}
	});

	test("installs one named skill from a repo that contains several", async () => {
		const dest = await mkdtemp(join(tmpdir(), "harness-user-skills-"));
		try {
			const result = await installSkillFromSource({
				source: "acme/pack@frontend-design",
				destRoot: dest,
				fetchFn: async (url) => {
					if (url.includes("/git/trees/")) {
						return Response.json({
							tree: [
								{ path: "skills/xlsx/SKILL.md", type: "blob" },
								{ path: "skills/frontend-design/SKILL.md", type: "blob" },
								{ path: "archive/frontend-design/SKILL.md", type: "blob" },
							],
						});
					}
					if (url.endsWith("skills/frontend-design/SKILL.md")) {
						return new Response(
							"---\nname: frontend-design\ndescription: ui\n---\n\n# Anthropic\n",
						);
					}
					if (url.endsWith("archive/frontend-design/SKILL.md")) {
						return new Response("---\nname: frontend-design\ndescription: old\n---\n\n# Old\n");
					}
					if (url.endsWith("skills/xlsx/SKILL.md")) {
						return new Response("---\nname: xlsx\ndescription: sheets\n---\n\n# Xlsx\n");
					}
					return new Response("missing", { status: 404 });
				},
			});
			expect(result).toEqual({ name: "frontend-design", rel: "frontend-design/SKILL.md" });
			const body = await readFile(join(dest, "frontend-design", "SKILL.md"), "utf8");
			expect(body).toContain("# Anthropic");
			expect(existsSync(join(dest, "xlsx"))).toBe(false);
			expect(existsSync(join(dest, "frontend-design", "xlsx"))).toBe(false);
		} finally {
			await rm(dest, { recursive: true, force: true });
		}
	});
});

describe("bundled catalog", () => {
	test("parses a bare name or bundled@ tag", () => {
		expect(parseBundledSkillRef("copywriting")).toBe("copywriting");
		expect(parseBundledSkillRef("bundled@impeccable")).toBe("impeccable");
		expect(parseBundledSkillRef("anthropics/skills@frontend-design")).toBeUndefined();
	});

	test("find lists bundled copy skills without a network call", async () => {
		const hits = bundledRegistryHits("copy");
		expect(hits.map((hit) => hit.name)).toContain("copywriting");
		expect(hits.map((hit) => hit.name)).not.toContain("copy-editor");
		const listed = await searchSkills(
			"copy",
			async () => new Response(JSON.stringify({ skills: [] })),
		);
		expect(listed).toContain("bundled@copywriting");
		expect(listed).not.toContain("bundled@copy-editor");
		const catalog = await searchSkillCatalog(
			"copy",
			async () =>
				new Response(
					JSON.stringify({
						skills: [
							{
								id: "acme/pack/copywriting",
								name: "copywriting",
								source: "acme/pack",
								installs: 3,
							},
						],
					}),
				),
		);
		expect(catalog.some((hit) => hit.source === "bundled" && hit.name === "copywriting")).toBe(
			true,
		);
		expect(catalog.some((hit) => hit.source === "acme/pack")).toBe(true);
	});

	test("installs the writing pack and removes it", async () => {
		const dest = await mkdtemp(join(tmpdir(), "harness-bundled-"));
		try {
			const result = await installSkillFromSource({ source: "copywriting", destRoot: dest });
			expect(result).toMatchObject({
				name: "copywriting",
				rel: "copywriting/SKILL.md",
				installed: ["copywriting", "copy-rmbc", "copy-harry-dry", "copy-editor"],
			});
			expect(existsSync(join(dest, "copy-editor", "references", "anti-slop.md"))).toBe(true);
			const merged = loadMergedSkills("/tmp/does-not-exist-host", dest);
			expect(merged.map((skill) => skill.name)).toEqual(
				expect.arrayContaining(["copywriting", "copy-rmbc", "copy-harry-dry", "copy-editor"]),
			);
			expect(merged.every((skill) => skill.source === "user")).toBe(true);

			const one = installBundledSkills("impeccable", dest);
			expect("error" in one).toBe(false);
			expect(existsSync(join(dest, "impeccable", "references", "visual-slop.md"))).toBe(true);

			const removed = removeSkillFromRoots("copywriting", [dest]);
			expect(removed.removed).toBe(true);
			expect(existsSync(join(dest, "copywriting"))).toBe(false);
			expect(existsSync(join(dest, "copy-editor"))).toBe(false);
			expect(existsSync(join(dest, "impeccable"))).toBe(true);
		} finally {
			await rm(dest, { recursive: true, force: true });
		}
	});
});

describe("user skill source", () => {
	test("marks ~/.harness skills as user and lets host win", async () => {
		const root = await mkdtemp(join(tmpdir(), "harness-merge-src-"));
		try {
			const user = join(root, "user");
			const host = join(root, "host");
			mkdirSync(join(user, "shared"), { recursive: true });
			mkdirSync(join(host, "shared"), { recursive: true });
			writeFileSync(join(user, "shared", "SKILL.md"), "---\nname: shared\n---\n\n# User\n");
			writeFileSync(join(host, "shared", "SKILL.md"), "---\nname: shared\n---\n\n# Host\n");
			const merged = loadMergedSkills(host, user);
			expect(merged.find((skill) => skill.name === "shared")?.source).toBe("host");
			expect(merged.find((skill) => skill.name === "shared")?.body).toContain("# Host");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
