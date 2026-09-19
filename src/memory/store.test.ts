import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	addFacts,
	deleteFact,
	isFactPinned,
	isSecretLike,
	listFacts,
	matchFact,
	pinFact,
	searchFacts,
	stripPinnedText,
	unpinFact,
} from "./store.ts";

async function withDirs() {
	const cwd = await mkdtemp(join(tmpdir(), "harness-mem-"));
	const home = await mkdtemp(join(tmpdir(), "harness-mem-home-"));
	const env = { HARNESS_HOME: home };
	return {
		cwd,
		env,
		async close() {
			await rm(cwd, { recursive: true, force: true });
			await rm(home, { recursive: true, force: true });
		},
	};
}

describe("memory store", () => {
	test("adds user and project facts and hash-dedups", async () => {
		const ctx = await withDirs();
		try {
			const first = addFacts(
				ctx.cwd,
				[
					{ text: "Prefer bun over npm", scope: "user" },
					{ text: "Tests live next to the source", scope: "project" },
				],
				ctx.env,
			);
			expect(first).toHaveLength(2);
			const again = addFacts(ctx.cwd, [{ text: "prefer bun over npm", scope: "user" }], ctx.env);
			expect(again).toHaveLength(0);
			const listed = listFacts(ctx.cwd, ctx.env);
			expect(listed.map((fact) => fact.text)).toEqual([
				"Prefer bun over npm",
				"Tests live next to the source",
			]);
			expect(listed[0]?.scope).toBe("user");
			expect(listed[1]?.scope).toBe("project");
		} finally {
			await ctx.close();
		}
	});

	test("drops secrets and tiny noise", async () => {
		expect(isSecretLike("OPENROUTER_API_KEY=sk-or-v1-abcdefgh")).toBe(true);
		const ctx = await withDirs();
		try {
			const added = addFacts(
				ctx.cwd,
				[
					{ text: "key=sk-or-v1-abcdefgh", scope: "user" },
					{ text: "short", scope: "user" },
					{ text: "Use the instrument blue for action color", scope: "user" },
				],
				ctx.env,
			);
			expect(added.map((fact) => fact.text)).toEqual(["Use the instrument blue for action color"]);
		} finally {
			await ctx.close();
		}
	});

	test("searches by overlap and recency", async () => {
		const ctx = await withDirs();
		try {
			addFacts(
				ctx.cwd,
				[
					{ text: "Prefer vim keybindings in the terminal", scope: "user" },
					{ text: "The desktop window talks to a loopback bridge", scope: "project" },
					{ text: "Prefer bun over npm for installs", scope: "user" },
				],
				ctx.env,
			);
			const hits = searchFacts(ctx.cwd, "which package manager for installs", 5, ctx.env);
			expect(hits[0]?.text).toContain("bun over npm");
			expect(searchFacts(ctx.cwd, "loopback bridge", 3, ctx.env)[0]?.text).toContain(
				"loopback bridge",
			);
			const personal = searchFacts(ctx.cwd, "whats my favorite club", 10, ctx.env);
			expect(personal.map((fact) => fact.text)).toEqual(
				expect.arrayContaining([
					"Prefer vim keybindings in the terminal",
					"Prefer bun over npm for installs",
				]),
			);
		} finally {
			await ctx.close();
		}
	});

	test("ranks a leftover name when a personal question has no matching noun", async () => {
		const ctx = await withDirs();
		try {
			addFacts(
				ctx.cwd,
				[
					{ text: "Lives in Riverton.", scope: "user" },
					{ text: "Enjoys football, beer, and walking.", scope: "user" },
					{ text: "Likes Northgate (frequent destination or hometown connection).", scope: "user" },
				],
				ctx.env,
			);
			const club = searchFacts(ctx.cwd, "whats my favorite club", 10, ctx.env);
			expect(club[0]?.text).toContain("Northgate");
			expect(club.map((fact) => fact.text).join("\n")).toContain("football");
			const home = searchFacts(ctx.cwd, "where do i live", 10, ctx.env);
			expect(home[0]?.text).toContain("Riverton");
			addFacts(ctx.cwd, [{ text: "Likes Westfield on weekends.", scope: "user" }], ctx.env);
			const ambiguous = searchFacts(ctx.cwd, "favourite football club", 10, ctx.env);
			expect(ambiguous[0]?.text).toContain("football");
			expect(ambiguous.some((fact) => fact.text.includes("Northgate"))).toBe(true);
			expect(ambiguous.some((fact) => fact.text.includes("Westfield"))).toBe(true);
		} finally {
			await ctx.close();
		}
	});

	test("deletes by id and matches list index", async () => {
		const ctx = await withDirs();
		try {
			addFacts(
				ctx.cwd,
				[
					{ text: "Prefer bun over npm", scope: "user" },
					{ text: "Keep desktop chrome compact", scope: "project" },
				],
				ctx.env,
			);
			const facts = listFacts(ctx.cwd, ctx.env);
			expect(matchFact(facts, "2")?.text).toContain("desktop chrome");
			expect(deleteFact(ctx.cwd, facts[0]?.id ?? "", ctx.env)?.text).toContain("bun");
			expect(listFacts(ctx.cwd, ctx.env)).toHaveLength(1);
		} finally {
			await ctx.close();
		}
	});

	test("pins a fact onto AGENTS.md", async () => {
		const ctx = await withDirs();
		try {
			const [fact] = addFacts(
				ctx.cwd,
				[{ text: "Do not add product telemetry", scope: "project" }],
				ctx.env,
			);
			const pinned = pinFact(ctx.cwd, fact!, "AGENTS.md", ctx.env);
			expect("path" in pinned).toBe(true);
			if ("path" in pinned) {
				expect(await readFile(pinned.path, "utf8")).toContain("Do not add product telemetry");
			}
			const again = pinFact(ctx.cwd, fact!, "AGENTS.md", ctx.env);
			expect("path" in again).toBe(true);
			const body = await readFile(join(ctx.cwd, "AGENTS.md"), "utf8");
			expect(body.match(/Do not add product telemetry/g)?.length).toBe(1);
			expect(isFactPinned(ctx.cwd, fact!, "AGENTS.md", ctx.env)).toBe(true);
			const unpinned = unpinFact(ctx.cwd, fact!, "AGENTS.md", ctx.env);
			expect(unpinned).toEqual({ path: join(ctx.cwd, "AGENTS.md"), removed: true });
			expect(isFactPinned(ctx.cwd, fact!, "AGENTS.md", ctx.env)).toBe(false);
			expect(await readFile(join(ctx.cwd, "AGENTS.md"), "utf8")).not.toContain(
				"Do not add product telemetry",
			);
		} finally {
			await ctx.close();
		}
	});

	test("stripPinnedText only drops a standalone copy of the fact", () => {
		expect(stripPinnedText("# Agents\n\nDo not add telemetry\n", "Do not add telemetry")).toBe(
			"# Agents\n",
		);
		expect(stripPinnedText("please Do not add telemetry in CI\n", "Do not add telemetry")).toBe(
			undefined,
		);
	});
});
