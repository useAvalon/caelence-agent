import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	browseSkillCatalog,
	buildSkillsPage,
	cachedPopularSkills,
	clearPopularSkillsCache,
	decorateCatalogSkill,
	formatInstallCount,
	POPULAR_SKILL_SEED,
	readPopularSkillsCache,
	refreshPopularSkills,
	skillBlurb,
	writePopularSkillsCache,
} from "./catalog.ts";

afterEach(() => {
	clearPopularSkillsCache();
});

describe("catalog skills", () => {
	test("blurb and install counts stay short", () => {
		expect(skillBlurb("Routes copy work through a pipeline of checks.")).toContain("Routes copy");
		expect(skillBlurb("word ".repeat(80)).endsWith("…")).toBe(true);
		expect(formatInstallCount(891_500)).toBe("891.5K");
		expect(formatInstallCount(3_400_000)).toBe("3.4M");
		expect(formatInstallCount(12)).toBe("12");
	});

	test("marks project skills as in-project and user skills as removable", () => {
		const loaded = [
			{ name: "copywriting", source: "host", description: "Router" },
			{
				name: "frontend-design",
				source: "user",
				catalogRef: "anthropics/skills@frontend-design",
			},
		];
		const bundled = decorateCatalogSkill(
			{ id: "bundled/copywriting", name: "copywriting", source: "bundled", description: "Router" },
			loaded,
		);
		expect(bundled).toMatchObject({
			id: "bundled@copywriting",
			status: "project",
			origin: "bundled",
		});
		const remote = decorateCatalogSkill(
			{
				id: "anthropics/skills/frontend-design",
				name: "frontend-design",
				source: "anthropics/skills",
				installs: 10,
			},
			loaded,
		);
		expect(remote).toMatchObject({
			id: "anthropics/skills@frontend-design",
			status: "user",
			origin: "skills.sh",
			installs: 10,
		});
		expect(
			decorateCatalogSkill(
				{ id: "bundled/copywriting", name: "copywriting", source: "bundled" },
				loaded,
				["copywriting"],
			).status,
		).toBe("off");
	});

	test("marks only the installed frontend-design source as added", () => {
		const loaded = [
			{
				name: "frontend-design",
				source: "user",
				catalogRef: "anthropics/skills@frontend-design",
			},
		];
		const anthropics = decorateCatalogSkill(
			{
				id: "anthropics/skills/frontend-design",
				name: "frontend-design",
				source: "anthropics/skills",
			},
			loaded,
		);
		const other = decorateCatalogSkill(
			{
				id: "pbakaus/impeccable/frontend-design",
				name: "frontend-design",
				source: "pbakaus/impeccable",
			},
			loaded,
		);
		expect(anthropics.status).toBe("user");
		expect(other.status).toBe("off");
	});

	test("page lists bundled skills and extra user skills separately", () => {
		const page = buildSkillsPage(
			[
				{ name: "copywriting", source: "host" },
				{ name: "copy-rmbc", source: "host" },
				{ name: "my-notes", source: "user" },
			],
			POPULAR_SKILL_SEED,
		);
		expect(
			page.bundled.some((item) => item.name === "copywriting" && item.status === "project"),
		).toBe(true);
		expect(page.loaded.some((item) => item.name === "my-notes" && item.status === "user")).toBe(
			true,
		);
		expect(page.popular.some((item) => item.name === "copywriting")).toBe(false);
		expect(page.bundled.some((item) => item.name === "copy-editor")).toBe(false);
		expect(page.bundled.some((item) => item.name === "impeccable")).toBe(true);
		expect(page.loaded.some((item) => item.name === "copy-rmbc")).toBe(false);
	});

	test("popular cache round-trips and refresh uses a bounded search", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-popular-"));
		const prev = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		try {
			writePopularSkillsCache(
				[{ id: "acme/pack/hello", name: "hello", source: "acme/pack", installs: 9 }],
				process.env,
			);
			const cached = readPopularSkillsCache(process.env);
			expect(cached.stale).toBe(false);
			expect(cached.hits[0]?.name).toBe("hello");
			expect(cachedPopularSkills(process.env)[0]?.name).toBe("hello");

			let called = 0;
			const hits = await refreshPopularSkills(async (url) => {
				called += 1;
				expect(url).toContain("q=frontend");
				expect(url).toContain("limit=16");
				return Response.json({
					skills: [
						{
							id: "acme/pack/hello",
							name: "hello",
							source: "acme/pack",
							installs: 99,
						},
					],
				});
			}, process.env);
			expect(called).toBe(1);
			expect(hits[0]).toMatchObject({ name: "hello", installs: 99 });
		} finally {
			if (prev === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prev;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("browse lists bundled skills then cached popular skills.sh hits", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-browse-"));
		const prev = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		try {
			writePopularSkillsCache(
				[
					{ id: "acme/pack/hello", name: "hello", source: "acme/pack", installs: 9 },
					{ id: "pbakaus/impeccable/impeccable", name: "impeccable", source: "pbakaus/impeccable" },
				],
				process.env,
			);
			const hits = await browseSkillCatalog(async () => {
				throw new Error("should use the fresh cache");
			}, process.env);
			expect(hits.some((hit) => hit.name === "copywriting" && hit.source === "bundled")).toBe(true);
			expect(hits.some((hit) => hit.name === "impeccable" && hit.source === "bundled")).toBe(true);
			expect(hits.some((hit) => hit.name === "hello")).toBe(true);
			expect(hits.filter((hit) => hit.name === "impeccable")).toHaveLength(1);
			expect(hits[0]?.source).toBe("bundled");
		} finally {
			if (prev === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prev;
			await rm(home, { recursive: true, force: true });
		}
	});
});
