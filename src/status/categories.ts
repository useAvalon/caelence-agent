import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_STATUS_VERBS, type StatusVerbsConfig } from "./status-verbs.ts";

let cached: Record<string, string[]> | undefined;

/** The themed verb lists, by name. Read from disk on first use. */
export function statusVerbCategories(): Record<string, string[]> {
	if (cached) return cached;
	try {
		const parsed = JSON.parse(
			readFileSync(join(import.meta.dir, "status-verb-categories.json"), "utf8"),
		) as Record<string, unknown>;
		const out: Record<string, string[]> = {};
		for (const [name, value] of Object.entries(parsed)) {
			if (!Array.isArray(value)) continue;
			out[name] = value.filter((item): item is string => typeof item === "string");
		}
		cached = out;
	} catch {
		cached = {};
	}
	return cached;
}

export function statusVerbCategoryNames(): string[] {
	return Object.keys(statusVerbCategories());
}

/**
 * The verbs a config asks for: the built-in list, the named categories and any custom ones,
 * without duplicates. Empty when verbs are turned off. `unknown` lists category names that
 * matched nothing, so a host can tell the user about a typo.
 */
export function resolveStatusVerbPool(config: StatusVerbsConfig | undefined): {
	pool: string[];
	unknown: string[];
} {
	if (config?.enabled === false) return { pool: [], unknown: [] };
	const pool = new Set<string>();
	const unknown: string[] = [];
	if (config?.defaults !== false) for (const verb of DEFAULT_STATUS_VERBS) pool.add(verb);
	if (config?.categories) {
		const all = statusVerbCategories();
		const byLower = new Map(Object.keys(all).map((name) => [name.toLowerCase(), name]));
		const names =
			config.categories === "all"
				? Object.keys(all)
				: config.categories.map((raw) => {
						const name = byLower.get(raw.trim().toLowerCase());
						if (!name) unknown.push(raw);
						return name;
					});
		for (const name of names) {
			if (!name) continue;
			for (const verb of all[name] ?? []) pool.add(verb);
		}
	}
	for (const verb of config?.custom ?? []) {
		const text = verb.trim();
		if (text) pool.add(text);
	}
	return { pool: [...pool], unknown };
}
