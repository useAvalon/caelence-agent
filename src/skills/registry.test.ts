import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMergedSkills } from "./loader.ts";
import {
	bundledRegistryHits,
	catalogNameFitsGithubFolders,
	clearGithubSkillFolderCache,
	dropUninstallableCatalogHits,
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

afterEach(() => {
	clearGithubSkillFolderCache();
});

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
		expect(parseSkillSource("anthropics/skills/frontend-design")).toMatchObject({
			owner: "anthropics",
			repo: "skills",
			skill: "frontend-design",
		});
		expect(parseSkillSource("smithery.ai@frontend-design")).toMatchObject({
			error:
				"smithery.ai@frontend-design is listed on skills.sh but is not a GitHub repo, so it cannot be added.",
		});
		expect(parseSkillSource("smithery.ai/frontend-design")).toMatchObject({
			error:
				"smithery.ai/frontend-design is listed on skills.sh but is not a GitHub repo, so it cannot be added.",
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

	test("drops skills.sh hosts that are not GitHub repos", async () => {
		const hits = await searchSkillsSh(
			"frontend-design",
			async () =>
				new Response(
					JSON.stringify({
						skills: [
							{
								id: "smithery.ai/frontend-design",
								name: "frontend-design",
								source: "smithery.ai",
								installs: 6216,
							},
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
		expect(hits.map((hit) => hit.source)).toEqual(["anthropics/skills"]);
	});

	test("drops skills.sh names that are not in that GitHub repo", async () => {
		const hits = await searchSkillsSh("frontend", async (url) => {
			const href = String(url);
			if (href.includes("/repos/openai/skills/git/trees/")) {
				return Response.json({
					tree: [
						{ path: "skills/aspnet-core/SKILL.md", type: "blob" },
						{ path: "skills/chatgpt-apps/SKILL.md", type: "blob" },
						{ path: "skills/skill-creator/SKILL.md", type: "blob" },
					],
				});
			}
			if (href.includes("/repos/pbakaus/impeccable/git/trees/")) {
				return Response.json({
					tree: [{ path: "SKILL.md", type: "blob" }],
				});
			}
			if (href.includes("/repos/anthropics/skills/git/trees/")) {
				return Response.json({
					tree: [{ path: "skills/frontend-design/SKILL.md", type: "blob" }],
				});
			}
			return Response.json({
				skills: [
					{
						id: "openai/skills/frontend-skill",
						name: "frontend-skill",
						source: "openai/skills",
						installs: 1600,
					},
					{
						id: "openai/skills/chatgpt-apps",
						name: "chatgpt-apps",
						source: "openai/skills",
						installs: 12,
					},
					{
						id: "pbakaus/impeccable/frontend-design",
						name: "frontend-design",
						source: "pbakaus/impeccable",
						installs: 40,
					},
					{
						id: "anthropics/skills/frontend-design",
						name: "frontend-design",
						source: "anthropics/skills",
						installs: 10,
					},
				],
			});
		});
		expect(hits.map((hit) => `${hit.source}/${hit.name}`)).toEqual([
			"openai/skills/chatgpt-apps",
			"pbakaus/impeccable/frontend-design",
			"anthropics/skills/frontend-design",
		]);
	});
});

describe("catalogNameFitsGithubFolders", () => {
	test("keeps YAML catalog names and drops generic ghosts", () => {
		expect(
			catalogNameFitsGithubFolders("frontend-skill", [
				"aspnet-core",
				"chatgpt-apps",
				"skill-creator",
			]),
		).toBe(false);
		expect(catalogNameFitsGithubFolders("chatgpt-apps", ["aspnet-core", "chatgpt-apps"])).toBe(
			true,
		);
		expect(
			catalogNameFitsGithubFolders("design-taste-frontend-v1", [
				"brandkit",
				"brutalist-skill",
				"taste-skill",
				"taste-skill-v1",
			]),
		).toBe(true);
		expect(catalogNameFitsGithubFolders("frontend-design", ["impeccable"])).toBe(true);
	});

	test("hides a name after GitHub confirms it is not in the repo", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-missing-"));
		const dest = await mkdtemp(join(tmpdir(), "harness-user-skills-"));
		const prev = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		clearGithubSkillFolderCache();
		try {
			const result = await installSkillFromSource({
				source: "openai/skills@frontend-skill",
				destRoot: dest,
				fetchFn: async (url) => {
					if (url.includes("/git/trees/")) {
						return Response.json({
							tree: [
								{ path: "skills/aspnet-core/SKILL.md", type: "blob" },
								{ path: "skills/chatgpt-apps/SKILL.md", type: "blob" },
							],
						});
					}
					return new Response("missing", { status: 404 });
				},
			});
			expect(result).toMatchObject({ error: 'No skill "frontend-skill" in openai/skills.' });
			expect(
				dropUninstallableCatalogHits([
					{
						id: "openai/skills/frontend-skill",
						name: "frontend-skill",
						source: "openai/skills",
					},
					{
						id: "openai/skills/chatgpt-apps",
						name: "chatgpt-apps",
						source: "openai/skills",
					},
				]).map((hit) => hit.name),
			).toEqual(["chatgpt-apps"]);
			const hits = await searchSkillsSh("frontend", async (url) => {
				if (String(url).includes("/git/trees/")) return new Response("no", { status: 403 });
				return Response.json({
					skills: [
						{
							id: "openai/skills/frontend-skill",
							name: "frontend-skill",
							source: "openai/skills",
						},
						{
							id: "openai/skills/chatgpt-apps",
							name: "chatgpt-apps",
							source: "openai/skills",
						},
					],
				});
			});
			expect(hits.map((hit) => hit.name)).toEqual(["chatgpt-apps"]);
		} finally {
			clearGithubSkillFolderCache();
			if (prev === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prev;
			await rm(home, { recursive: true, force: true });
			await rm(dest, { recursive: true, force: true });
		}
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
			expect(result).toEqual({ name: "hello", rel: "acme-pack-hello/SKILL.md" });
			const body = await readFile(join(dest, "acme-pack-hello", "SKILL.md"), "utf8");
			expect(body).toContain("# Hello");
			expect(await readFile(join(dest, "acme-pack-hello", ".catalog-ref"), "utf8")).toBe(
				"acme/pack@hello\n",
			);
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
			expect(result).toEqual({
				name: "frontend-design",
				rel: "acme-pack-frontend-design/SKILL.md",
			});
			const body = await readFile(join(dest, "acme-pack-frontend-design", "SKILL.md"), "utf8");
			expect(body).toContain("# Anthropic");
			expect(existsSync(join(dest, "xlsx"))).toBe(false);
			expect(existsSync(join(dest, "frontend-design"))).toBe(false);
		} finally {
			await rm(dest, { recursive: true, force: true });
		}
	});

	test("keeps two skills.sh rows with the same YAML name in separate folders", async () => {
		const dest = await mkdtemp(join(tmpdir(), "harness-user-skills-"));
		try {
			const fetchFn = async (url: string) => {
				if (url.includes("/repos/acme/pack/") && url.includes("/git/trees/")) {
					return Response.json({ tree: [{ path: "frontend-design/SKILL.md", type: "blob" }] });
				}
				if (url.includes("/repos/other/ui/") && url.includes("/git/trees/")) {
					return Response.json({ tree: [{ path: "frontend-design/SKILL.md", type: "blob" }] });
				}
				if (url.includes("/acme/pack/") && url.endsWith("frontend-design/SKILL.md")) {
					return new Response("---\nname: frontend-design\n---\n\n# Acme\n");
				}
				if (url.includes("/other/ui/") && url.endsWith("frontend-design/SKILL.md")) {
					return new Response("---\nname: frontend-design\n---\n\n# Other\n");
				}
				return new Response("missing", { status: 404 });
			};
			await installSkillFromSource({
				source: "acme/pack/frontend-design",
				destRoot: dest,
				fetchFn,
			});
			await installSkillFromSource({ source: "other/ui/frontend-design", destRoot: dest, fetchFn });
			expect(existsSync(join(dest, "acme-pack-frontend-design", "SKILL.md"))).toBe(true);
			expect(existsSync(join(dest, "other-ui-frontend-design", "SKILL.md"))).toBe(true);
			const merged = loadMergedSkills("/tmp/does-not-exist-host", dest);
			expect(merged.filter((skill) => skill.name === "frontend-design")).toHaveLength(2);
			const removed = removeSkillFromRoots("acme/pack/frontend-design", [dest]);
			expect(removed.removed).toBe(true);
			expect(existsSync(join(dest, "acme-pack-frontend-design"))).toBe(false);
			expect(existsSync(join(dest, "other-ui-frontend-design"))).toBe(true);
		} finally {
			await rm(dest, { recursive: true, force: true });
		}
	});

	test("installs a single-skill repo listed under a different catalog name", async () => {
		const dest = await mkdtemp(join(tmpdir(), "harness-user-skills-"));
		try {
			const result = await installSkillFromSource({
				source: "pbakaus/impeccable/frontend-design",
				destRoot: dest,
				fetchFn: async (url) => {
					if (url.includes("/git/trees/")) {
						return Response.json({
							tree: [
								{ path: ".claude/skills/impeccable/SKILL.md", type: "blob" },
								{ path: ".cursor/skills/impeccable/SKILL.md", type: "blob" },
								{ path: ".cursor/skills/impeccable/scripts/run.sh", type: "blob" },
								{ path: "plugin/skills/impeccable/SKILL.md", type: "blob" },
								{
									path: "tests/oracle/workspaces/ctx-pin/.claude/skills/audit/SKILL.md",
									type: "blob",
								},
								{
									path: "tests/oracle/workspaces/ctx-pin/.claude/skills/impeccable/SKILL.md",
									type: "blob",
								},
							],
						});
					}
					if (url.endsWith("impeccable/SKILL.md")) {
						return new Response("---\nname: impeccable\ndescription: ui\n---\n\n# Impeccable\n");
					}
					return new Response("missing", { status: 404 });
				},
			});
			expect(result).toEqual({
				name: "impeccable",
				rel: "pbakaus-impeccable-frontend-design/SKILL.md",
			});
			expect(existsSync(join(dest, "pbakaus-impeccable-frontend-design", "SKILL.md"))).toBe(true);
			expect(existsSync(join(dest, "audit"))).toBe(false);
		} finally {
			await rm(dest, { recursive: true, force: true });
		}
	});

	test("matches a YAML catalog name after more than 12 other folders", async () => {
		const dest = await mkdtemp(join(tmpdir(), "harness-user-skills-"));
		try {
			const fillers = Array.from({ length: 12 }, (_, i) => `skills/alpha-${i}/SKILL.md`);
			const result = await installSkillFromSource({
				source: "leonxlnx/taste-skill@design-taste-frontend-v1",
				destRoot: dest,
				fetchFn: async (url) => {
					if (url.includes("/git/trees/")) {
						return Response.json({
							tree: [
								...fillers.map((path) => ({ path, type: "blob" })),
								{ path: "skills/taste-skill-v1/SKILL.md", type: "blob" },
							],
						});
					}
					if (url.endsWith("skills/taste-skill-v1/SKILL.md")) {
						return new Response("---\nname: design-taste-frontend-v1\n---\n\n# Taste v1\n");
					}
					if (url.endsWith("SKILL.md")) {
						return new Response("---\nname: filler\n---\n\n# Filler\n");
					}
					return new Response("missing", { status: 404 });
				},
			});
			expect(result).toEqual({
				name: "design-taste-frontend-v1",
				rel: "leonxlnx-taste-skill-design-taste-frontend-v1/SKILL.md",
			});
			const body = await readFile(
				join(dest, "leonxlnx-taste-skill-design-taste-frontend-v1", "SKILL.md"),
				"utf8",
			);
			expect(body).toContain("# Taste v1");
		} finally {
			await rm(dest, { recursive: true, force: true });
		}
	});

	test("installs a skill that has more than 40 reference files", async () => {
		const dest = await mkdtemp(join(tmpdir(), "harness-user-skills-"));
		try {
			const tree = [
				{ path: ".github/skills/impeccable/SKILL.md", type: "blob" },
				...Array.from({ length: 40 }, (_, i) => ({
					path: `.github/skills/impeccable/reference/n${i}.md`,
					type: "blob",
				})),
			];
			const result = await installSkillFromSource({
				source: "pbakaus/impeccable/frontend-design",
				destRoot: dest,
				fetchFn: async (url) => {
					if (url.includes("/git/trees/")) return Response.json({ tree });
					if (url.endsWith("SKILL.md")) {
						return new Response("---\nname: impeccable\n---\n\n# Impeccable\n");
					}
					if (url.endsWith(".md")) return new Response("# ref\n");
					return new Response("missing", { status: 404 });
				},
			});
			expect(result).toMatchObject({ name: "impeccable" });
			expect(existsSync(join(dest, "pbakaus-impeccable-frontend-design", "SKILL.md"))).toBe(true);
			expect(
				existsSync(join(dest, "pbakaus-impeccable-frontend-design", "reference", "n0.md")),
			).toBe(true);
		} finally {
			await rm(dest, { recursive: true, force: true });
		}
	});

	test("matches a catalog name to YAML when the folder differs", async () => {
		const dest = await mkdtemp(join(tmpdir(), "harness-user-skills-"));
		try {
			const result = await installSkillFromSource({
				source: "acme/pack@frontend-design",
				destRoot: dest,
				fetchFn: async (url) => {
					if (url.includes("/git/trees/")) {
						return Response.json({
							tree: [
								{ path: "skills/ui/SKILL.md", type: "blob" },
								{ path: "skills/xlsx/SKILL.md", type: "blob" },
							],
						});
					}
					if (url.endsWith("skills/ui/SKILL.md")) {
						return new Response("---\nname: frontend-design\n---\n\n# UI\n");
					}
					if (url.endsWith("skills/xlsx/SKILL.md")) {
						return new Response("---\nname: xlsx\n---\n\n# Sheets\n");
					}
					return new Response("missing", { status: 404 });
				},
			});
			expect(result).toEqual({
				name: "frontend-design",
				rel: "acme-pack-frontend-design/SKILL.md",
			});
			const body = await readFile(join(dest, "acme-pack-frontend-design", "SKILL.md"), "utf8");
			expect(body).toContain("# UI");
		} finally {
			await rm(dest, { recursive: true, force: true });
		}
	});

	test("lists unique skill folders when the catalog name is missing", async () => {
		const dest = await mkdtemp(join(tmpdir(), "harness-user-skills-"));
		try {
			const result = await installSkillFromSource({
				source: "acme/pack@frontend-design",
				destRoot: dest,
				fetchFn: async (url) => {
					if (url.includes("/git/trees/")) {
						return Response.json({
							tree: [
								{ path: ".cursor/skills/impeccable/SKILL.md", type: "blob" },
								{ path: ".claude/skills/impeccable/SKILL.md", type: "blob" },
								{ path: "skills/audit/SKILL.md", type: "blob" },
							],
						});
					}
					if (url.endsWith("impeccable/SKILL.md")) {
						return new Response("---\nname: impeccable\n---\n\n# Impeccable\n");
					}
					if (url.endsWith("audit/SKILL.md")) {
						return new Response("---\nname: audit\n---\n\n# Audit\n");
					}
					return new Response("missing", { status: 404 });
				},
			});
			expect(result).toMatchObject({
				error: 'No skill "frontend-design" in acme/pack.',
				choices: ["audit", "impeccable"],
			});
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
