import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { resolveConfigPath } from "./config.ts";
import { harnessHome } from "./desktop/secrets.ts";

export function standaloneWorkspaceDir(
	env: Record<string, string | undefined> = process.env,
): string {
	return resolve(harnessHome(env), "workspace");
}

export function ensureStandaloneWorkspace(
	env: Record<string, string | undefined> = process.env,
): string {
	const dir = standaloneWorkspaceDir(env);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function isProjectRoot(dir: string): boolean {
	if (resolveConfigPath(dir)) return true;
	return existsSync(resolve(dir, ".git"));
}

/** Nearest git repo or harness.config, not the home directory. */
export function findProjectRoot(
	start: string,
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const home = resolve(env.HOME?.trim() || homedir());
	let dir = resolve(start);
	while (true) {
		if (dir !== home && isProjectRoot(dir)) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/** `--cwd` wins. Else a project root from `start`. Else `~/.harness/workspace`. */
export function resolveAgentCwd(input: {
	start: string;
	explicit?: string;
	env?: Record<string, string | undefined>;
}): string {
	const env = input.env ?? process.env;
	const explicit = input.explicit?.trim();
	if (explicit) return resolve(explicit);
	return findProjectRoot(input.start, env) ?? ensureStandaloneWorkspace(env);
}
