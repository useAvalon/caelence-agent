import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { errorMessage } from "../core/errors.ts";
import { listBundledSkills, parseSkillMarkdown, SKILL_CATALOG_REF_FILE } from "./loader.ts";

/** Bare names that install more than one catalog folder. */
export const BUNDLED_PACKS: Record<string, readonly string[]> = {
	copy: ["copywriting", "copy-rmbc", "copy-harry-dry", "copy-editor"],
	copywriting: ["copywriting", "copy-rmbc", "copy-harry-dry", "copy-editor"],
};

function catalogPackNames(): string[] {
	return Object.keys(BUNDLED_PACKS).filter((key) => key !== "copy");
}

/** Pipeline steps that are not addable on their own. */
function packStepNames(): Set<string> {
	const steps = new Set<string>();
	for (const pack of catalogPackNames()) {
		for (const member of BUNDLED_PACKS[pack] ?? []) {
			if (member !== pack) steps.add(member);
		}
	}
	return steps;
}

export function bundledPackStepNames(): Set<string> {
	return packStepNames();
}

const SEARCH_URL = trimTrailingSlashes(process.env.SKILLS_API_URL?.trim() || "https://skills.sh");
const MAX_FILES = 40;
const MAX_FILE_BYTES = 512 * 1024;

function trimTrailingSlashes(value: string): string {
	let end = value.length;
	while (end > 0 && value.endsWith("/")) {
		value = value.slice(0, -1);
		end = value.length;
	}
	return value;
}

function isRepoToken(value: string): boolean {
	return /^[A-Za-z0-9_.-]+$/.test(value);
}

function parseGithubPath(pathname: string): ParsedSkillSource | undefined {
	const parts = pathname.split("/").filter(Boolean);
	const owner = parts[0];
	const repoRaw = parts[1];
	if (!owner || !repoRaw) return undefined;
	const repo = repoRaw.replace(/\.git$/, "");
	const kind = parts[2];
	if (kind !== "tree" && kind !== "blob") return { owner, repo, ref: "HEAD" };
	const ref = parts[3] || "HEAD";
	const rest = parts.slice(4).join("/");
	const path = trimTrailingSlashes(rest.replace(/\/SKILL\.md$/i, ""));
	return {
		owner,
		repo,
		ref,
		...(path ? { path, skill: path.split("/").pop() } : {}),
	};
}

export interface RegistryHit {
	name: string;
	source: string;
	installs?: number;
	id: string;
	description?: string;
}

export interface ParsedSkillSource {
	owner: string;
	repo: string;
	skill?: string;
	path?: string;
	ref: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function parseHttpSkillSource(
	value: string,
): ParsedSkillSource | { url: string } | { error: string } {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { url: value };
	}
	const host = url.hostname.toLowerCase();
	if (host === "skills.sh" || host === "www.skills.sh") {
		return parseSkillSource(trimTrailingSlashes(url.pathname).replace(/^\//, ""));
	}
	if (host === "github.com" || host === "www.github.com") {
		const parsed = parseGithubPath(url.pathname);
		if (parsed) return parsed;
	}
	if (host === "raw.githubusercontent.com") {
		const parts = url.pathname.split("/").filter(Boolean);
		const owner = parts[0];
		const repo = parts[1];
		const ref = parts[2] || "HEAD";
		const path = parts
			.slice(3)
			.join("/")
			.replace(/\/SKILL\.md$/i, "");
		if (owner && repo) return { owner, repo, ref, ...(path ? { path } : {}) };
	}
	return { url: value };
}

function parseOwnerRepo(value: string): ParsedSkillSource | undefined {
	const at = value.indexOf("@");
	if (at > 0) {
		const left = value.slice(0, at);
		const skill = value.slice(at + 1);
		const slash = left.indexOf("/");
		if (slash > 0) {
			const owner = left.slice(0, slash);
			const repo = left.slice(slash + 1);
			if (isRepoToken(owner) && isRepoToken(repo) && skill) {
				return { owner, repo, skill, ref: "HEAD" };
			}
		}
	}
	const parts = value.split("/");
	const owner = parts[0];
	const repo = parts[1];
	if (!owner || !repo || !isRepoToken(owner) || !isRepoToken(repo)) return undefined;
	const path = trimTrailingSlashes(parts.slice(2).join("/"));
	return {
		owner,
		repo,
		ref: "HEAD",
		...(path ? { path, skill: path.split("/").pop() } : {}),
	};
}

export function parseSkillSource(
	raw: string,
): ParsedSkillSource | { url: string } | { error: string } {
	const value = raw.trim();
	if (!value) return { error: "Source is empty." };
	if (value.startsWith("http://") || value.startsWith("https://")) {
		return parseHttpSkillSource(value);
	}
	const parsed = parseOwnerRepo(value);
	if (parsed) return parsed;
	return {
		error: "Use a bundled name, owner/repo, owner/repo@skill, or a GitHub / skills.sh URL.",
	};
}

export function parseBundledSkillRef(raw: string): string | undefined {
	const value = raw.trim();
	if (!value) return undefined;
	const tagged = /^(?:bundled[@/])([a-z0-9_.-]+)$/i.exec(value);
	if (tagged?.[1]) return tagged[1];
	if (isRepoToken(value) && !value.includes("/")) return value;
	return undefined;
}

export function bundledInstallNames(name: string): string[] | undefined {
	const key = name.trim().toLowerCase();
	if (!key) return undefined;
	const pack = BUNDLED_PACKS[key];
	if (pack) return [...pack];
	for (const packName of catalogPackNames()) {
		const members = BUNDLED_PACKS[packName] ?? [];
		if (members.some((member) => member === key)) return [...members];
	}
	const found = listBundledSkills().find((skill) => skill.name.toLowerCase() === key);
	return found ? [found.name] : undefined;
}

export function bundledRegistryHits(query: string): RegistryHit[] {
	const q = query.trim().toLowerCase();
	const seen = new Set<string>();
	const hits: RegistryHit[] = [];
	const catalog = listBundledSkills();
	const byName = new Map(catalog.map((skill) => [skill.name.toLowerCase(), skill]));
	const steps = packStepNames();
	for (const pack of catalogPackNames()) {
		const members = BUNDLED_PACKS[pack] ?? [];
		if (
			q &&
			q !== "bundled" &&
			!pack.includes(q) &&
			!members.some((member) => member.includes(q))
		) {
			continue;
		}
		seen.add(pack);
		const skill = byName.get(pack);
		hits.push({
			id: `bundled/${pack}`,
			name: pack,
			source: "bundled",
			...(skill?.description ? { description: skill.description } : {}),
		});
	}
	for (const skill of catalog) {
		const key = skill.name.toLowerCase();
		if (steps.has(key) || seen.has(key)) continue;
		if (q && q !== "bundled" && !key.includes(q) && !skill.description.toLowerCase().includes(q)) {
			continue;
		}
		seen.add(key);
		hits.push({
			id: `bundled/${skill.name}`,
			name: skill.name,
			source: "bundled",
			description: skill.description,
		});
	}
	return hits;
}

export function formatBundledHits(hits: RegistryHit[]): string {
	return hits.map((hit) => `bundled@${hit.name}`).join("\n");
}

export function skillCatalogRef(hit: RegistryHit): string {
	if (hit.source === "bundled") return `bundled@${hit.name}`;
	return `${hit.source}@${hit.name}`;
}

/** True when this loaded skill is the catalog row, not another skill with the same name. */
export function skillIsCatalogHit(
	skill: { name: string; source: string; catalogRef?: string },
	hit: RegistryHit,
): boolean {
	const ref = skillCatalogRef(hit);
	if (skill.catalogRef) return skill.catalogRef === ref || skill.catalogRef === hit.id;
	if (skill.source === "user") {
		return (
			skill.name.toLowerCase() === hit.name.toLowerCase() &&
			(hit.source === "user" || hit.source === "project")
		);
	}
	return skill.name.toLowerCase() === hit.name.toLowerCase();
}

export async function searchSkillCatalog(
	query: string,
	fetchFn: FetchLike = fetch,
): Promise<RegistryHit[]> {
	const bundled = bundledRegistryHits(query);
	try {
		const remote = await searchSkillsSh(query, fetchFn, { limit: 16 });
		const seen = new Set(bundled.map((hit) => skillCatalogRef(hit)));
		return [...bundled, ...remote.filter((hit) => !seen.has(skillCatalogRef(hit)))];
	} catch (err) {
		if (bundled.length > 0) return bundled;
		throw err;
	}
}

export async function searchSkills(query: string, fetchFn: FetchLike = fetch): Promise<string> {
	try {
		const hits = await searchSkillCatalog(query, fetchFn);
		if (hits.length === 0) return "No matches.";
		const bundled = hits.filter((hit) => hit.source === "bundled");
		const remote = hits.filter((hit) => hit.source !== "bundled");
		return [formatBundledHits(bundled), remote.length > 0 ? formatRegistryHits(remote) : ""]
			.filter(Boolean)
			.join("\n");
	} catch (err) {
		return errorMessage(err);
	}
}

export function installBundledSkills(
	name: string,
	destRoot: string,
): { name: string; rel: string; installed: string[] } | { error: string; choices?: string[] } {
	const names = bundledInstallNames(name);
	const catalog = listBundledSkills();
	if (!names) {
		const choices = bundledRegistryHits("").map((hit) => hit.name);
		return { error: `No bundled skill ${JSON.stringify(name)}.`, choices };
	}
	const byName = new Map(catalog.map((skill) => [skill.name.toLowerCase(), skill]));
	const installed: string[] = [];
	for (const entry of names) {
		const skill = byName.get(entry.toLowerCase());
		if (!skill) return { error: `Bundled skill ${entry} is missing from the package.` };
		const slug = skill.name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/^-|-$/g, "");
		if (!slug) return { error: "Skill name is empty." };
		const dest = join(destRoot, slug);
		try {
			rmSync(dest, { recursive: true, force: true });
			cpSync(dirname(skill.path), dest, { recursive: true });
			writeFileSync(join(dest, SKILL_CATALOG_REF_FILE), `bundled@${slug}\n`);
		} catch (err) {
			return { error: errorMessage(err) };
		}
		installed.push(slug);
	}
	const first = installed[0] ?? name;
	return { name: first, rel: `${first}/SKILL.md`, installed };
}

export async function searchSkillsSh(
	query: string,
	fetchFn: FetchLike = fetch,
	options: { limit?: number } = {},
): Promise<RegistryHit[]> {
	const q = query.trim();
	if (!q) return [];
	const limit = String(Math.min(Math.max(options.limit ?? 10, 1), 20));
	const url = `${SEARCH_URL}/api/search?${new URLSearchParams({ q, limit }).toString()}`;
	const res = await fetchFn(url, { headers: { accept: "application/json" } });
	if (!res.ok) throw new Error(`skills.sh search failed (${res.status})`);
	const data = (await res.json()) as {
		skills?: Array<{ id?: string; name?: string; source?: string; installs?: number }>;
	};
	return (data.skills ?? [])
		.map((row) => ({
			id: String(row.id ?? row.name ?? ""),
			name: String(row.name ?? row.id ?? ""),
			source: String(row.source ?? ""),
			...(typeof row.installs === "number" ? { installs: row.installs } : {}),
		}))
		.filter((row) => row.name && row.source);
}

export function formatRegistryHits(hits: RegistryHit[]): string {
	if (hits.length === 0) return "No skills.sh matches.";
	return hits
		.map((hit) => {
			const count = hit.installs !== undefined ? `  ${hit.installs}` : "";
			return `${hit.source}@${hit.name}${count}`;
		})
		.join("\n");
}

export async function installSkillFromSource(input: {
	source: string;
	skill?: string;
	destRoot: string;
	fetchFn?: FetchLike;
}): Promise<
	{ name: string; rel: string; installed?: string[] } | { error: string; choices?: string[] }
> {
	const bundledName = parseBundledSkillRef(input.source);
	if (bundledName && !input.skill) {
		return installBundledSkills(bundledName, input.destRoot);
	}
	const parsed = parseSkillSource(input.source);
	if ("error" in parsed) return parsed;
	if ("url" in parsed)
		return installFromDirectUrl(parsed.url, input.destRoot, input.fetchFn ?? fetch);
	const skill = input.skill?.trim() || parsed.skill;
	const catalogRef = input.source.includes("@")
		? input.source
		: skill
			? `${parsed.owner}/${parsed.repo}@${skill}`
			: `${parsed.owner}/${parsed.repo}`;
	return installFromGithub({
		...parsed,
		skill,
		destRoot: input.destRoot,
		fetchFn: input.fetchFn ?? fetch,
		catalogRef,
	});
}

async function installFromDirectUrl(
	url: string,
	destRoot: string,
	fetchFn: FetchLike,
): Promise<{ name: string; rel: string } | { error: string }> {
	const res = await fetchFn(url);
	if (!res.ok) return { error: `Download failed (${res.status})` };
	const markdown = await res.text();
	if (!markdown.includes("name:") || !markdown.includes("---")) {
		return { error: "URL is not a SKILL.md." };
	}
	const parsed = parseSkillMarkdown(markdown, "SKILL.md", ".");
	return writeSkillDir(destRoot, parsed.name, { "SKILL.md": markdown });
}

function skillFolderName(path: string, repo: string): string {
	return dirname(path) === "." ? repo : (dirname(path).split("/").pop() ?? path);
}

function skillPathMatches(path: string, wanted: string, input: ParsedSkillSource): boolean {
	const folder = skillFolderName(path, input.repo);
	if (folder.toLowerCase() !== wanted) return false;
	const lower = path.toLowerCase();
	if (input.path) {
		const prefix = input.path.toLowerCase().replace(/\/+$/, "");
		return lower === `${prefix}/skill.md` || lower.startsWith(`${prefix}/`);
	}
	return lower === `${wanted}/skill.md` || lower.endsWith(`/${wanted}/skill.md`);
}

function pickSkillMd(matches: string[]): string {
	return [...matches].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? "";
}

async function installFromGithub(
	input: ParsedSkillSource & {
		destRoot: string;
		fetchFn: FetchLike;
		skill?: string;
		catalogRef?: string;
	},
): Promise<{ name: string; rel: string } | { error: string; choices?: string[] }> {
	const treeUrl = `https://api.github.com/repos/${input.owner}/${input.repo}/git/trees/${input.ref}?recursive=1`;
	const res = await input.fetchFn(treeUrl, {
		headers: {
			accept: "application/vnd.github+json",
			"user-agent": "caelence-harness",
		},
	});
	if (!res.ok)
		return { error: `GitHub tree failed (${res.status}) for ${input.owner}/${input.repo}` };
	const data = (await res.json()) as { tree?: Array<{ path?: string; type?: string }> };
	const skillFiles = (data.tree ?? [])
		.map((node) => node.path ?? "")
		.filter((path) => path.endsWith("/SKILL.md") || path === "SKILL.md")
		.filter(
			(path) => !path.split("/").some((part) => part === "node_modules" || part === "examples"),
		);
	if (skillFiles.length === 0) return { error: `No SKILL.md in ${input.owner}/${input.repo}` };

	const wanted = input.skill?.toLowerCase() || input.path?.split("/").pop()?.toLowerCase();
	const matches = wanted
		? skillFiles.filter((path) => skillPathMatches(path, wanted, input))
		: skillFiles;

	if (matches.length === 0) {
		return {
			error: `No skill ${JSON.stringify(input.skill)} in ${input.owner}/${input.repo}.`,
			choices: skillFiles.map((path) => skillFolderName(path, input.repo)),
		};
	}
	if (matches.length > 1 && !wanted) {
		return {
			error: "Repo has several skills. Add @name.",
			choices: matches.map((path) => skillFolderName(path, input.repo)),
		};
	}

	const skillMd = pickSkillMd(matches);
	const root = dirname(skillMd) === "." ? "" : dirname(skillMd);
	const files = (data.tree ?? [])
		.map((node) => node.path ?? "")
		.filter(
			(path) => path && (root ? path === root || path.startsWith(`${root}/`) : path === "SKILL.md"),
		);
	if (files.length > MAX_FILES) return { error: `Skill has more than ${MAX_FILES} files.` };

	const downloaded = await downloadSkillFiles(input, files, skillMd, root);
	if ("error" in downloaded) return downloaded;
	const markdown = downloaded["SKILL.md"];
	if (!markdown) return { error: "Could not download SKILL.md." };
	const name = parseSkillMarkdown(markdown, "SKILL.md", ".").name;
	const catalogRef =
		input.catalogRef?.trim() ||
		(input.skill ? `${input.owner}/${input.repo}@${input.skill}` : undefined);
	return writeSkillDir(input.destRoot, name, downloaded, catalogRef);
}

async function downloadSkillFiles(
	input: ParsedSkillSource & { fetchFn: FetchLike },
	files: string[],
	skillMd: string,
	root: string,
): Promise<Record<string, string> | { error: string }> {
	const downloaded: Record<string, string> = {};
	for (const path of files) {
		if (!path.endsWith(".md") && !path.endsWith(".txt") && path !== skillMd) continue;
		const raw = `https://raw.githubusercontent.com/${input.owner}/${input.repo}/${input.ref}/${path}`;
		const file = await input.fetchFn(raw, { headers: { "user-agent": "caelence-harness" } });
		if (!file.ok) continue;
		const text = await file.text();
		if (text.length > MAX_FILE_BYTES) return { error: `File too large: ${path}` };
		const rel = root ? path.slice(root.length + 1) : path;
		if (!rel || rel.includes("..")) continue;
		downloaded[rel] = text;
	}
	return downloaded;
}

function writeSkillDir(
	destRoot: string,
	name: string,
	files: Record<string, string>,
	catalogRef?: string,
): { name: string; rel: string } | { error: string } {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-|-$/g, "");
	if (!slug) return { error: "Skill name is empty." };
	const dest = join(destRoot, slug);
	try {
		rmSync(dest, { recursive: true, force: true });
		mkdirSync(dest, { recursive: true });
		for (const [rel, body] of Object.entries(files)) {
			const abs = join(dest, rel);
			if (!abs.startsWith(dest)) continue;
			mkdirSync(dirname(abs), { recursive: true });
			writeFileSync(abs, body, "utf8");
		}
		if (catalogRef?.trim()) {
			writeFileSync(join(dest, SKILL_CATALOG_REF_FILE), `${catalogRef.trim()}\n`);
		}
	} catch (err) {
		return { error: errorMessage(err) };
	}
	return { name: slug, rel: `${slug}/SKILL.md` };
}

export function removeInstalledSkill(
	destRoot: string,
	name: string,
): { removed: boolean; reason?: string } {
	const slug = name.trim().toLowerCase();
	if (!slug) return { removed: false, reason: "Name is empty." };
	const dest = join(destRoot, slug);
	if (!existsSync(dest)) return { removed: false, reason: "Not installed." };
	try {
		rmSync(dest, { recursive: true, force: true });
		return { removed: true };
	} catch (err) {
		return { removed: false, reason: errorMessage(err) };
	}
}

export function removeSkillFromRoots(
	name: string,
	roots: string[],
): { removed: boolean; reason?: string } {
	const names = bundledInstallNames(name) ?? [name];
	let removed = 0;
	for (const entry of names) {
		for (const root of roots) {
			if (removeInstalledSkill(root, entry).removed) removed += 1;
		}
	}
	if (removed === 0)
		return { removed: false, reason: `Skill ${JSON.stringify(name)} is not installed.` };
	return { removed: true };
}
