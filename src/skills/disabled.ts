import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bundledInstallNames } from "./registry.ts";

export function disabledSkillsPath(cwd: string): string {
	return resolve(cwd, ".harness", "disabled-skills.json");
}

function expandSkillNames(name: string): string[] {
	const key = name.trim().toLowerCase();
	if (!key) return [];
	return (bundledInstallNames(key) ?? [key]).map((entry) => entry.toLowerCase());
}

export function readDisabledSkillNames(cwd: string): Set<string> {
	const path = disabledSkillsPath(cwd);
	if (!existsSync(path)) return new Set();
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { names?: unknown };
		if (!Array.isArray(parsed.names)) return new Set();
		return new Set(
			parsed.names
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => entry.trim().toLowerCase())
				.filter(Boolean),
		);
	} catch {
		return new Set();
	}
}

function writeDisabledSkillNames(cwd: string, names: Set<string>): void {
	const path = disabledSkillsPath(cwd);
	mkdirSync(resolve(path, ".."), { recursive: true });
	const list = [...names].sort();
	writeFileSync(path, `${JSON.stringify({ names: list }, null, "\t")}\n`);
}

export function isSkillDisabled(cwd: string, name: string): boolean {
	return readDisabledSkillNames(cwd).has(name.trim().toLowerCase());
}

export function disableSkills(cwd: string, name: string): string[] {
	const added = expandSkillNames(name);
	if (added.length === 0) return [];
	const names = readDisabledSkillNames(cwd);
	for (const entry of added) names.add(entry);
	writeDisabledSkillNames(cwd, names);
	return added;
}

export function enableSkills(cwd: string, name: string): string[] {
	const removed = expandSkillNames(name);
	if (removed.length === 0) return [];
	const names = readDisabledSkillNames(cwd);
	for (const entry of removed) names.delete(entry);
	writeDisabledSkillNames(cwd, names);
	return removed;
}
