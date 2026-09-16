import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Glob } from "bun";
import { shouldSkipDir } from "../tools/paths.ts";

export interface Skill {
	name: string;
	description: string;
	body: string;
	path: string;
	relPath: string;
	source: "bundled" | "host" | "user";
	/** Catalog id this copy was installed from, e.g. anthropics/skills@frontend-design. */
	catalogRef?: string;
}

export function stripFrontmatter(md: string): { attrs: Record<string, string>; body: string } {
	const trimmed = md.replace(/^\uFEFF/, "");
	if (!trimmed.startsWith("---")) return { attrs: {}, body: trimmed.trim() };
	const end = trimmed.indexOf("\n---", 3);
	if (end < 0) return { attrs: {}, body: trimmed.trim() };
	const raw = trimmed.slice(3, end).replace(/^\n/, "");
	const body = trimmed
		.slice(end + 4)
		.replace(/^\s*\n/, "")
		.trim();
	return { attrs: parseFrontmatter(raw), body };
}

function splitFrontmatterLine(line: string): { key: string; value: string } | undefined {
	if (/^\s/.test(line)) return undefined;
	const colon = line.indexOf(":");
	if (colon <= 0) return undefined;
	const key = line.slice(0, colon);
	if (!/^[A-Za-z0-9_-]+$/.test(key)) return undefined;
	return { key, value: line.slice(colon + 1).trim() };
}

function readFoldedFrontmatterValue(
	lines: string[],
	start: number,
): { value: string; next: number } {
	const folded: string[] = [];
	let i = start;
	while (i < lines.length) {
		const next = lines[i] ?? "";
		if (splitFrontmatterLine(next)) break;
		folded.push(next.replace(/^\s{2,}/, ""));
		i += 1;
	}
	return { value: folded.join(" ").replaceAll(/\s+/g, " ").trim(), next: i };
}

function parseFrontmatter(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const lines = raw.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const match = splitFrontmatterLine(line);
		if (!match) {
			i += 1;
			continue;
		}
		const foldedMarks = new Set([">", ">|", ">-", "|", "|-"]);
		if (foldedMarks.has(match.value)) {
			const folded = readFoldedFrontmatterValue(lines, i + 1);
			attrs[match.key] = folded.value;
			i = folded.next;
			continue;
		}
		let value = match.value;
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		attrs[match.key] = value;
		i += 1;
	}
	return attrs;
}

export const SKILL_CATALOG_REF_FILE = ".catalog-ref";

export function parseSkillMarkdown(md: string, absPath: string, root: string): Skill {
	const { attrs, body } = stripFrontmatter(md);
	const name = attrs.name?.trim() || dirname(absPath).split("/").pop() || "skill";
	const description = attrs.description?.trim() || "";
	return {
		name,
		description,
		body,
		path: absPath,
		relPath: relative(root, absPath).replaceAll("\\", "/"),
		source: "host",
	};
}

export function bundledSkillsDir(): string {
	return join(import.meta.dir, "..", "..", "skills");
}

/** True when `abs` is the package catalog, not a host project overlay. */
export function isBundledCatalogDir(abs: string): boolean {
	const bundled = bundledSkillsDir();
	try {
		if (existsSync(abs) && existsSync(bundled)) {
			return realpathSync(abs) === realpathSync(bundled);
		}
	} catch {
		/* compare resolved paths below */
	}
	return resolve(abs) === resolve(bundled);
}

function skillMergeKey(skill: Skill): string {
	const ref = skill.catalogRef?.trim();
	if (ref) return `ref:${ref.replaceAll("@", "/").toLowerCase()}`;
	return `name:${skill.name.toLowerCase()}`;
}

/** Later writers win. Used to overlay host skills on a catalog or user store. */
export function mergeSkills(first: Skill[], host: Skill[]): Skill[] {
	const byKey = new Map<string, Skill>();
	for (const skill of first) byKey.set(skillMergeKey(skill), skill);
	for (const skill of host) byKey.set(skillMergeKey(skill), { ...skill, source: "host" });
	return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Skills shipped with the package. Not loaded until `/skill add`. */
export function listBundledSkills(): Skill[] {
	return loadSkills(bundledSkillsDir()).map((skill) => ({ ...skill, source: "bundled" as const }));
}

/** Extra folders we read so a host is not locked to Cursor. Writes still go to config.skillsDir. */
export const CONVENTIONAL_HOST_SKILL_DIRS = ["skills", ".cursor/skills", ".claude/skills"] as const;

export function resolveHostSkillDirs(cwd: string, configured: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const rel of [configured, ...CONVENTIONAL_HOST_SKILL_DIRS]) {
		const abs = resolve(cwd, rel);
		if (seen.has(abs) || isBundledCatalogDir(abs)) continue;
		seen.add(abs);
		if (existsSync(abs)) out.push(abs);
	}
	if (out.length === 0) {
		const fallback = resolve(cwd, configured);
		if (!isBundledCatalogDir(fallback)) out.push(fallback);
	}
	return out;
}

export function loadMergedSkills(hostSkillsDir: string | string[], userDir?: string): Skill[] {
	const dirs = Array.isArray(hostSkillsDir) ? hostSkillsDir : [hostSkillsDir];
	const byKey = new Map<string, Skill>();
	if (userDir) {
		for (const skill of loadSkills(userDir)) {
			byKey.set(skillMergeKey(skill), { ...skill, source: "user" });
		}
	}
	for (const dir of dirs) {
		for (const skill of loadSkills(dir)) {
			byKey.set(skillMergeKey(skill), { ...skill, source: "host" });
		}
	}
	return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSkills(skillsDir: string): Skill[] {
	const skills: Skill[] = [];
	try {
		const glob = new Glob("**/SKILL.md");
		for (const rel of glob.scanSync({ cwd: skillsDir, onlyFiles: true, dot: false })) {
			const parts = rel.split("/");
			if (parts.length !== 2 || parts[1] !== "SKILL.md") continue;
			if (parts.some((p) => shouldSkipDir(p))) continue;
			const abs = join(skillsDir, rel);
			const md = readFileSync(abs, "utf8");
			const skill = parseSkillMarkdown(md, abs, skillsDir);
			const catalogRefPath = join(dirname(abs), SKILL_CATALOG_REF_FILE);
			if (existsSync(catalogRefPath)) {
				const catalogRef = readFileSync(catalogRefPath, "utf8").trim();
				if (catalogRef) skill.catalogRef = catalogRef;
			}
			skills.push(skill);
		}
	} catch {
		return [];
	}
	skills.sort((a, b) => a.name.localeCompare(b.name));
	return skills;
}

export function skillCatalogPrompt(skills: Skill[]): string {
	if (skills.length === 0) return "";
	const lines = skills.map((s) => {
		const origin = s.catalogRef || s.source;
		return `- ${s.name} (${origin})`;
	});
	return [
		"## Skills",
		"Skills are instruction files, not tools. When a task matches a name, read it with read_skill. Do not list or quote these unless the user asks. If two skills share a name, pass the catalog id in parentheses.",
		...lines,
	].join("\n");
}

export function skillBodiesForNames(skills: Skill[], names: string[]): string {
	const wanted = new Set(names.map((n) => n.trim().toLowerCase().replaceAll("@", "/")));
	return skills
		.filter((s) => {
			const name = s.name.toLowerCase();
			const ref = s.catalogRef?.replaceAll("@", "/").toLowerCase();
			return wanted.has(name) || (ref ? wanted.has(ref) : false);
		})
		.map((s) => `# Skill: ${s.name}\n\n${s.body}`)
		.join("\n\n");
}
