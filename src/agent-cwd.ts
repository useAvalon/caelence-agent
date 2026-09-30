import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { resolveConfigPath } from "./config.ts";
import { harnessHome } from "./desktop/secrets.ts";

export function lastProjectCwdPath(env: Record<string, string | undefined> = process.env): string {
	return resolve(harnessHome(env), "last-project-cwd");
}

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

function readLastProjectCwd(
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const path = lastProjectCwdPath(env);
	if (!existsSync(path)) return undefined;
	try {
		const line = readFileSync(path, "utf8").trim();
		if (!line) return undefined;
		const dir = resolve(line);
		if (!existsSync(dir) || !isProjectRoot(dir)) return undefined;
		return dir;
	} catch {
		return undefined;
	}
}

/** Remember a git repo or harness.config root for the next standalone launch. */
export function rememberProjectCwd(
	cwd: string,
	env: Record<string, string | undefined> = process.env,
): void {
	const dir = resolve(cwd);
	if (dir === resolve(standaloneWorkspaceDir(env))) return;
	if (!isProjectRoot(dir)) return;
	try {
		mkdirSync(harnessHome(env), { recursive: true });
		writeFileSync(lastProjectCwdPath(env), `${dir}\n`, "utf8");
	} catch {
		// best effort
	}
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

/** `--cwd` wins. Else a project root from `start`. Else last project, then `~/.harness/workspace`. */
export function resolveAgentCwd(input: {
	start: string;
	explicit?: string;
	env?: Record<string, string | undefined>;
}): string {
	const env = input.env ?? process.env;
	const explicit = input.explicit?.trim();
	if (explicit) {
		const dir = resolve(explicit);
		rememberProjectCwd(dir, env);
		return dir;
	}
	const found = findProjectRoot(input.start, env);
	if (found) {
		rememberProjectCwd(found, env);
		return found;
	}
	const last = readLastProjectCwd(env);
	if (last) return last;
	return ensureStandaloneWorkspace(env);
}
