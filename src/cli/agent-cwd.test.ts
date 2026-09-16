import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ensureStandaloneWorkspace,
	findProjectRoot,
	resolveAgentCwd,
	standaloneWorkspaceDir,
} from "../agent-cwd.ts";

async function tempDir(prefix: string): Promise<string> {
	const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`);
	await mkdir(dir, { recursive: true });
	return dir;
}

describe("resolveAgentCwd", () => {
	test("explicit --cwd wins", async () => {
		const cwd = await tempDir("agent-cwd-explicit-");
		try {
			expect(resolveAgentCwd({ start: tmpdir(), explicit: cwd })).toBe(cwd);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("walks up to a git root", async () => {
		const root = await tempDir("agent-cwd-git-");
		const nested = join(root, "src", "cli");
		try {
			await mkdir(join(root, ".git"));
			await mkdir(nested, { recursive: true });
			expect(findProjectRoot(nested)).toBe(root);
			expect(resolveAgentCwd({ start: nested })).toBe(root);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("uses harness.config.ts as a project root", async () => {
		const root = await tempDir("agent-cwd-config-");
		try {
			await writeFile(join(root, "harness.config.ts"), "export default {}\n");
			expect(findProjectRoot(root)).toBe(root);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("home is not a project even with .git", async () => {
		const home = await tempDir("agent-cwd-home-");
		const harnessHome = await tempDir("agent-cwd-home-harness-");
		try {
			await mkdir(join(home, ".git"));
			const env = { HOME: home, HARNESS_HOME: harnessHome };
			expect(findProjectRoot(home, env)).toBeUndefined();
			expect(resolveAgentCwd({ start: home, env })).toBe(standaloneWorkspaceDir(env));
			expect(ensureStandaloneWorkspace(env)).toBe(join(harnessHome, "workspace"));
		} finally {
			await rm(home, { recursive: true, force: true });
			await rm(harnessHome, { recursive: true, force: true });
		}
	});
});
