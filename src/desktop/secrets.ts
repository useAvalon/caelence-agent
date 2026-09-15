import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export function harnessHome(env: Record<string, string | undefined> = process.env): string {
	const override = env.HARNESS_HOME?.trim();
	if (override) return resolve(override);
	return resolve(homedir(), ".harness");
}

export function openRouterKeyPath(env: Record<string, string | undefined> = process.env): string {
	return resolve(harnessHome(env), "openrouter-key");
}

export function maskSecret(value: string): string {
	const key = value.trim();
	if (!key) return "";
	if (key.length <= 4) return "••••";
	return `••••${key.slice(-4)}`;
}

export function readOpenRouterKey(env: Record<string, string | undefined> = process.env): string {
	const path = openRouterKeyPath(env);
	if (!existsSync(path)) return "";
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return "";
	}
}

export function writeOpenRouterKey(
	value: string,
	env: Record<string, string | undefined> = process.env,
): void {
	const path = openRouterKeyPath(env);
	const key = value.trim();
	if (!key) {
		if (existsSync(path)) unlinkSync(path);
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${key}\n`, { encoding: "utf8", mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		// best-effort on filesystems that ignore mode
	}
}

/** Prefer the process env. Fall back to the file in ~/.harness. */
export function applyStoredOpenRouterKey(
	env: Record<string, string | undefined> = process.env,
): string {
	const fromEnv = env.OPENROUTER_API_KEY?.trim() ?? "";
	if (fromEnv) return fromEnv;
	const stored = readOpenRouterKey(env);
	if (stored) env.OPENROUTER_API_KEY = stored;
	return stored;
}
