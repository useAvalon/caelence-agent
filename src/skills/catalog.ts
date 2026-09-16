import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { harnessHome } from "../desktop/secrets.ts";
import {
	bundledPackStepNames,
	bundledRegistryHits,
	dropUninstallableCatalogHits,
	type FetchLike,
	filterGithubCatalogHits,
	isInstallableSkillsShHit,
	type RegistryHit,
	searchSkillsSh,
	skillCatalogRef,
	skillIsCatalogHit,
} from "./registry.ts";

export const POPULAR_TTL_MS = 24 * 60 * 60 * 1000;
const POPULAR_LIMIT = 16;
const POPULAR_QUERY = "frontend";

/** Shown before the first skills.sh fetch, and if the network call fails. */
export const POPULAR_SKILL_SEED: RegistryHit[] = [
	{ id: "anthropics/skills/frontend-design", name: "frontend-design", source: "anthropics/skills" },
	{
		id: "vercel-labs/agent-skills/vercel-react-best-practices",
		name: "vercel-react-best-practices",
		source: "vercel-labs/agent-skills",
	},
	{
		id: "vercel-labs/agent-skills/web-design-guidelines",
		name: "web-design-guidelines",
		source: "vercel-labs/agent-skills",
	},
	{
		id: "vercel-labs/agent-browser/agent-browser",
		name: "agent-browser",
		source: "vercel-labs/agent-browser",
	},
	{ id: "obra/superpowers/brainstorming", name: "brainstorming", source: "obra/superpowers" },
	{
		id: "obra/superpowers/test-driven-development",
		name: "test-driven-development",
		source: "obra/superpowers",
	},
	{ id: "pbakaus/impeccable/impeccable", name: "impeccable", source: "pbakaus/impeccable" },
	{ id: "anthropics/skills/xlsx", name: "xlsx", source: "anthropics/skills" },
	{ id: "supabase/agent-skills/supabase", name: "supabase", source: "supabase/agent-skills" },
	{
		id: "nextlevelbuilder/ui-ux-pro-max-skill/ui-ux-pro-max",
		name: "ui-ux-pro-max",
		source: "nextlevelbuilder/ui-ux-pro-max-skill",
	},
];

export type SkillInstallStatus = "off" | "user" | "project";

export interface CatalogSkill {
	id: string;
	name: string;
	description: string;
	origin: "bundled" | "skills.sh";
	source: string;
	installs?: number;
	status: SkillInstallStatus;
}

export interface SkillsPage {
	bundled: CatalogSkill[];
	popular: CatalogSkill[];
	loaded: CatalogSkill[];
}

export function skillBlurb(text: string, max = 140): string {
	const one = text.replace(/\s+/g, " ").trim();
	if (!one) return "";
	if (one.length <= max) return one;
	const clipped = one.slice(0, max - 1);
	const cut = clipped.lastIndexOf(" ");
	return `${(cut > 80 ? clipped.slice(0, cut) : clipped).trimEnd()}…`;
}

export function formatInstallCount(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
	return String(count);
}

export function bundledSkillHits(query = ""): RegistryHit[] {
	return bundledRegistryHits(query);
}

export function withDisabledCatalogSkills(
	loaded: Array<{ name: string; source: string; description?: string; catalogRef?: string }>,
	disabled: Iterable<string>,
): Array<{ name: string; source: string; description?: string; catalogRef?: string }> {
	const seen = new Set(loaded.map((skill) => skill.name.toLowerCase()));
	const extra = [...disabled]
		.map((name) => name.trim().toLowerCase())
		.filter((name) => name && !seen.has(name))
		.map((name) => ({ name, source: "host" as const }));
	return extra.length === 0 ? loaded : [...loaded, ...extra];
}

function catalogStatus(
	current: { source: string } | undefined,
	disabled: boolean,
): "user" | "project" | "off" {
	if (disabled || !current) return "off";
	if (current.source === "user") return "user";
	return "project";
}

export function decorateCatalogSkill(
	hit: RegistryHit,
	loaded: Array<{ name: string; source: string; description?: string; catalogRef?: string }>,
	disabled: Iterable<string> = [],
): CatalogSkill {
	const current = loaded.find((skill) => skillIsCatalogHit(skill, hit));
	const off = new Set([...disabled].map((name) => name.toLowerCase()));
	const disabledHit = hit.source === "bundled" && off.has(hit.name.toLowerCase());
	return {
		id: skillCatalogRef(hit),
		name: hit.name,
		description: skillBlurb(hit.description || current?.description || ""),
		origin: hit.source === "bundled" ? "bundled" : "skills.sh",
		source: hit.source === "host" ? "project" : hit.source,
		...(typeof hit.installs === "number" ? { installs: hit.installs } : {}),
		status: catalogStatus(current, disabledHit),
	};
}

function catalogOwnerRepo(ref?: string): string {
	const value = ref?.trim();
	if (!value || /^(bundled|user|host|project)[@/]/i.test(value)) return "";
	const parts = value.replaceAll("@", "/").split("/").filter(Boolean);
	if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
	return "";
}

export function buildSkillsPage(
	loaded: Array<{ name: string; source: string; description?: string; catalogRef?: string }>,
	popularHits: RegistryHit[],
	disabled: Iterable<string> = [],
): SkillsPage {
	const bundled = bundledSkillHits().map((hit) => decorateCatalogSkill(hit, loaded, disabled));
	const bundledNames = new Set(bundled.map((item) => item.name.toLowerCase()));
	const steps = bundledPackStepNames();
	const popular = dropUninstallableCatalogHits(popularHits)
		.filter((hit) => hit.source !== "bundled" && !bundledNames.has(hit.name.toLowerCase()))
		.map((hit) => decorateCatalogSkill(hit, loaded, disabled));
	const listed = [...bundledSkillHits(), ...popularHits];
	const extra = loaded
		.filter((skill) => {
			const key = skill.name.toLowerCase();
			if (steps.has(key)) return false;
			return !listed.some((hit) => skillIsCatalogHit(skill, hit));
		})
		.map((skill) =>
			decorateCatalogSkill(
				{
					id: skill.catalogRef ?? `${skill.source}/${skill.name}`,
					name: skill.name,
					source:
						catalogOwnerRepo(skill.catalogRef) || (skill.source === "user" ? "user" : "project"),
					description: skill.description ?? "",
				},
				loaded,
				disabled,
			),
		);
	return { bundled, popular, loaded: extra };
}

let memory: { home: string; expires: number; hits: RegistryHit[] } | null = null;

export function clearPopularSkillsCache(): void {
	memory = null;
}

function popularPath(env: Record<string, string | undefined> = process.env): string {
	return resolve(harnessHome(env), "skills-sh-popular.json");
}

function cacheHome(env: Record<string, string | undefined> = process.env): string {
	return harnessHome(env);
}

function parseHitRow(row: unknown): RegistryHit | undefined {
	if (!row || typeof row !== "object") return undefined;
	const item = row as Record<string, unknown>;
	const name = typeof item.name === "string" ? item.name.trim() : "";
	const source = typeof item.source === "string" ? item.source.trim() : "";
	const id = typeof item.id === "string" ? item.id.trim() : "";
	if (!name || !source || !isInstallableSkillsShHit({ source })) return undefined;
	return {
		id: id || `${source}/${name}`,
		name,
		source,
		...(typeof item.installs === "number" ? { installs: item.installs } : {}),
		...(typeof item.description === "string" ? { description: item.description } : {}),
	};
}

function parseHits(raw: unknown): RegistryHit[] | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const hits = (raw as { hits?: unknown }).hits;
	if (!Array.isArray(hits)) return undefined;
	const out: RegistryHit[] = [];
	for (const row of hits) {
		const hit = parseHitRow(row);
		if (hit) out.push(hit);
	}
	return out;
}

export function readPopularSkillsCache(
	env: Record<string, string | undefined> = process.env,
	now = Date.now(),
): { hits: RegistryHit[]; stale: boolean } {
	if (memory?.hits.length && memory.home === cacheHome(env)) {
		return { hits: memory.hits, stale: memory.expires <= now };
	}
	if (!existsSync(popularPath(env))) {
		return { hits: POPULAR_SKILL_SEED, stale: true };
	}
	try {
		const parsed = JSON.parse(readFileSync(popularPath(env), "utf8")) as {
			expires?: number;
			hits?: unknown;
		};
		const hits = parseHits(parsed);
		if (!hits || hits.length === 0) return { hits: POPULAR_SKILL_SEED, stale: true };
		const expires = typeof parsed.expires === "number" ? parsed.expires : 0;
		memory = { home: cacheHome(env), expires, hits };
		return { hits, stale: expires <= now };
	} catch {
		return { hits: POPULAR_SKILL_SEED, stale: true };
	}
}

export function writePopularSkillsCache(
	hits: RegistryHit[],
	env: Record<string, string | undefined> = process.env,
	now = Date.now(),
): void {
	const expires = now + POPULAR_TTL_MS;
	memory = { home: cacheHome(env), expires, hits };
	const path = popularPath(env);
	mkdirSync(resolve(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ expires, hits }, null, "\t")}\n`);
}

export function cachedPopularSkills(
	env: Record<string, string | undefined> = process.env,
): RegistryHit[] {
	return readPopularSkillsCache(env).hits;
}

export async function browseSkillCatalog(
	fetchFn: FetchLike = fetch,
	env: Record<string, string | undefined> = process.env,
): Promise<RegistryHit[]> {
	const bundled = bundledRegistryHits("");
	const cached = readPopularSkillsCache(env);
	const popular = cached.stale ? await refreshPopularSkills(fetchFn, env) : cached.hits;
	const seen = new Set(bundled.map((hit) => hit.name.toLowerCase()));
	const remote = await filterGithubCatalogHits(
		popular.filter(
			(hit) =>
				hit.source !== "bundled" &&
				isInstallableSkillsShHit(hit) &&
				!seen.has(hit.name.toLowerCase()),
		),
		fetchFn,
	);
	return [...bundled, ...remote];
}

export async function refreshPopularSkills(
	fetchFn: FetchLike = fetch,
	env: Record<string, string | undefined> = process.env,
): Promise<RegistryHit[]> {
	try {
		const remote = await searchSkillsSh(POPULAR_QUERY, fetchFn, { limit: POPULAR_LIMIT });
		const byId = new Map<string, RegistryHit>();
		for (const hit of [...remote, ...POPULAR_SKILL_SEED]) {
			const key = skillCatalogRef(hit);
			if (!byId.has(key)) byId.set(key, hit);
		}
		const hits = [...byId.values()]
			.sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0))
			.slice(0, POPULAR_LIMIT);
		if (hits.length > 0) writePopularSkillsCache(hits, env);
		return hits.length > 0 ? hits : cachedPopularSkills(env);
	} catch {
		return cachedPopularSkills(env);
	}
}
