import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface InitOptions {
	cwd: string;
	name?: string;
	/** Write harness.config.ts, AGENTS.md, a sample skill, and a smoke eval. */
	examples?: boolean;
}

const AGENTS = `# Agent instructions

You are a coding agent in this repository. Prefer small, targeted edits.
Do not invent metrics, testimonials, or sample numbers.

Copy and visual-QA skills are optional. If copywriting or impeccable is in the
skill catalog, read it with read_skill when the task matches. Do not assume
they are loaded.
`;

const SKILL = `---
name: hello
description: >-
  A sample skill. Replace this with project-specific instructions the agent
  should load when the task matches.
---

# Hello

Read this skill when the user asks for a sample skill.
`;

const EVAL = `import type { EvalSuite } from "@useavalon/caelence-agent";

const suite: EvalSuite = {
	name: "smoke",
	steps: [
		{
			id: "echo",
			system: "Reply with exactly: ok",
			user: "ping",
			artifact: "echo.txt",
			scan: (text) => ({ ok: text.trim().toLowerCase().includes("ok") }),
		},
	],
};

export default suite;
`;

function configSource(name: string): string {
	return `import type { HarnessConfig } from "@useavalon/caelence-agent";

export default {
	name: ${JSON.stringify(name)},
	model: "openrouter/auto",
	instructionsFile: "AGENTS.md",
	skillsDir: "skills",
	evalsDir: "evals",
	theme: "caelence",
	mode: "agent",
	tools: { exec: { approval: "prompt" } },
	mcp: [],
} satisfies HarnessConfig;
`;
}

function writeNew(
	path: string,
	contents: string,
	created: string[],
	skipped: string[],
	rel: string,
): void {
	if (existsSync(path)) {
		skipped.push(rel);
		return;
	}
	writeFileSync(path, contents, "utf8");
	created.push(rel);
}

function ignoreHarnessDir(cwd: string, created: string[], skipped: string[]): void {
	const gitignorePath = join(cwd, ".gitignore");
	if (existsSync(gitignorePath)) {
		const current = readFileSync(gitignorePath, "utf8");
		if (!current.split("\n").some((line) => line.trim() === ".harness/")) {
			appendFileSync(gitignorePath, current.endsWith("\n") ? ".harness/\n" : "\n.harness/\n");
			created.push(".gitignore (append .harness/)");
		} else {
			skipped.push(".gitignore");
		}
		return;
	}
	writeFileSync(gitignorePath, ".harness/\n", "utf8");
	created.push(".gitignore");
}

/** Ignore `.harness/`. With `examples`, also write a host scaffold. Existing files stay. */
export function initHost(options: InitOptions): { created: string[]; skipped: string[] } {
	const cwd = options.cwd;
	const created: string[] = [];
	const skipped: string[] = [];

	ignoreHarnessDir(cwd, created, skipped);

	if (!options.examples) return { created, skipped };

	const name = options.name ?? "caelence";
	mkdirSync(join(cwd, "skills", "hello"), { recursive: true });
	mkdirSync(join(cwd, "evals", "smoke"), { recursive: true });

	writeNew(
		join(cwd, "harness.config.ts"),
		configSource(name),
		created,
		skipped,
		"harness.config.ts",
	);
	writeNew(join(cwd, "AGENTS.md"), AGENTS, created, skipped, "AGENTS.md");
	writeNew(join(cwd, "skills/hello/SKILL.md"), SKILL, created, skipped, "skills/hello/SKILL.md");
	writeNew(join(cwd, "evals/smoke/eval.ts"), EVAL, created, skipped, "evals/smoke/eval.ts");

	return { created, skipped };
}
