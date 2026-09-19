import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { harnessHome } from "../desktop/secrets.ts";

export interface MemoryPrefs {
	enabled: boolean;
}

export function memoryPrefsPath(env: Record<string, string | undefined> = process.env): string {
	return resolve(harnessHome(env), "memory.json");
}

export function readMemoryPrefs(
	env: Record<string, string | undefined> = process.env,
): Partial<MemoryPrefs> {
	const path = memoryPrefsPath(env);
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<MemoryPrefs>;
		if (typeof parsed.enabled === "boolean") return { enabled: parsed.enabled };
		return {};
	} catch {
		return {};
	}
}

export function writeMemoryPrefs(
	patch: Partial<MemoryPrefs>,
	env: Record<string, string | undefined> = process.env,
): MemoryPrefs {
	const next: MemoryPrefs = {
		enabled: patch.enabled ?? readMemoryPrefs(env).enabled ?? false,
	};
	const path = memoryPrefsPath(env);
	mkdirSync(resolve(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, "\t")}\n`);
	return next;
}

export function isMemoryEnabled(input: {
	configEnabled?: boolean;
	env?: Record<string, string | undefined>;
}): boolean {
	const prefs = readMemoryPrefs(input.env);
	if (typeof prefs.enabled === "boolean") return prefs.enabled;
	return input.configEnabled === true;
}
