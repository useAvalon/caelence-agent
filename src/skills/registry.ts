import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { errorMessage } from "../core/errors.ts";
import { harnessHome } from "../desktop/secrets.ts";
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
const MAX_FILES = 80;
const MAX_FILE_BYTES = 512 * 1024;
const GENERIC_SKILL_TOKENS = new Set([
	"skill",
	"skills",
	"frontend",
	"backend",
	"design",
	"ui",
	"web",
	"app",
	"v1",
	"v2",
	"v3",
	"agent",
	"code",
	"kit",
]);
const YAML_NAME_SCAN_LIMIT = 40;

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

/** GitHub logins cannot be a registry host like smithery.ai. */
function isGithubLogin(value: string): boolean {
	if (/\.(ai|com|cn|io|dev|app|org|net|sh|co)$/i.test(value)) return false;
	return isRepoToken(value);
}

function slugifySkillId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

/** `owner/repo@skill` and `owner/repo/skill` are the same catalog row. */
export function normalizeCatalogKey(value: string): string {
	return value.trim().replaceAll("@", "/").toLowerCase();
}

export function catalogRefsMatch(left: string, right: string): boolean {
	return normalizeCatalogKey(left) === normalizeCatalogKey(right);
}

export function skillNameFromCatalogId(id: string): string {
	const value = id.trim();
	if (!value) return "";
	const bundled = /^bundled[@/](.+)$/i.exec(value);
	if (bundled?.[1]) return bundled[1];
	const at = value.lastIndexOf("@");
	if (at > 0) return value.slice(at + 1);
	const slash = value.lastIndexOf("/");
	if (slash >= 0) return value.slice(slash + 1);
	return value;
}

export function isBundledCatalogId(id: string): boolean {
	const value = id.trim();
	if (!value) return false;
	if (/^bundled[@/]/i.test(value)) return true;
	return !value.includes("/") && !value.includes("@");
}

export function skillInstallDirName(yamlName: string, catalogRef?: string): string {
	const nameSlug = slugifySkillId(yamlName);
	if (!catalogRef || catalogRef.startsWith("bundled@")) return nameSlug;
	return slugifySkillId(catalogRef.replaceAll("@", "/")) || nameSlug;
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
			if (isGithubLogin(owner) && isRepoToken(repo) && skill) {
				return { owner, repo, skill, ref: "HEAD" };
			}
		} else if (isGithubLogin(left) && skill) {
			return parseOwnerRepo(`${left}/${skill}`);
		}
	}
	const parts = value.split("/");
	const owner = parts[0];
	const repo = parts[1];
	if (!owner || !repo || !isGithubLogin(owner) || !isRepoToken(repo)) return undefined;
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
	if (/^[A-Za-z0-9_.-]+\.[A-Za-z]{2,}(?:[@/]|$)/.test(value)) {
		return {
			error: `${value} is listed on skills.sh but is not a GitHub repo, so it cannot be added.`,
		};
	}
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
		if (members.includes(key)) return [...members];
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
	if (hit.id.includes("/")) return hit.id;
	if (hit.source.includes("/")) return `${hit.source}@${hit.name}`;
	return hit.source ? `${hit.source}/${hit.name}` : hit.name;
}

/** skills.sh rows we can fetch from GitHub. Hosts like smithery.ai are listings only. */
export function isInstallableSkillsShHit(hit: { source: string }): boolean {
	if (hit.source === "bundled") return true;
	const slash = hit.source.indexOf("/");
	if (slash <= 0) return false;
	const owner = hit.source.slice(0, slash);
	const repo = hit.source.slice(slash + 1);
	return Boolean(owner && repo && !repo.includes("/") && isGithubLogin(owner) && isRepoToken(repo));
}

const githubFolderCache = new Map<string, string[]>();
const missingCatalogKeys = new Set<string>();
let githubFolderDiskLoaded = false;
let missingCatalogDiskLoaded = false;

function githubFoldersPath(env: Record<string, string | undefined> = process.env): string {
	return resolve(harnessHome(env), "github-skill-folders.json");
}

function missingCatalogPath(env: Record<string, string | undefined> = process.env): string {
	return resolve(harnessHome(env), "skills-sh-missing.json");
}

function loadGithubFolderDisk(env: Record<string, string | undefined> = process.env): void {
	if (githubFolderDiskLoaded) return;
	githubFolderDiskLoaded = true;
	try {
		if (!existsSync(githubFoldersPath(env))) return;
		const parsed = JSON.parse(readFileSync(githubFoldersPath(env), "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object") return;
		for (const [source, folders] of Object.entries(parsed as Record<string, unknown>)) {
			if (githubFolderCache.has(source) || !Array.isArray(folders)) continue;
			githubFolderCache.set(
				source,
				folders.filter(
					(folder): folder is string => typeof folder === "string" && folder.length > 0,
				),
			);
		}
	} catch {
		// Ignore a broken cache file.
	}
}

function saveGithubFolderDisk(env: Record<string, string | undefined> = process.env): void {
	try {
		mkdirSync(harnessHome(env), { recursive: true });
		writeFileSync(
			githubFoldersPath(env),
			`${JSON.stringify(Object.fromEntries(githubFolderCache), null, "\t")}\n`,
		);
	} catch {
		// Memory cache is enough if the home dir is not writable.
	}
}

function loadMissingCatalogDisk(env: Record<string, string | undefined> = process.env): void {
	if (missingCatalogDiskLoaded) return;
	missingCatalogDiskLoaded = true;
	try {
		if (!existsSync(missingCatalogPath(env))) return;
		const parsed = JSON.parse(readFileSync(missingCatalogPath(env), "utf8")) as unknown;
		if (!Array.isArray(parsed)) return;
		for (const id of parsed) {
			if (typeof id === "string" && id.trim()) missingCatalogKeys.add(normalizeCatalogKey(id));
		}
	} catch {
		// Ignore a broken cache file.
	}
}

function saveMissingCatalogDisk(env: Record<string, string | undefined> = process.env): void {
	try {
		mkdirSync(harnessHome(env), { recursive: true });
		writeFileSync(
			missingCatalogPath(env),
			`${JSON.stringify([...missingCatalogKeys], null, "\t")}\n`,
		);
	} catch {
		// Memory cache is enough if the home dir is not writable.
	}
}

function rememberGithubSkillFolders(
	source: string,
	folders: string[],
	env: Record<string, string | undefined> = process.env,
): void {
	loadGithubFolderDisk(env);
	githubFolderCache.set(source, folders);
	saveGithubFolderDisk(env);
}

export function rememberMissingCatalogSkill(
	id: string,
	env: Record<string, string | undefined> = process.env,
): void {
	const key = normalizeCatalogKey(id);
	if (!key || isBundledCatalogId(id)) return;
	loadMissingCatalogDisk(env);
	missingCatalogKeys.add(key);
	saveMissingCatalogDisk(env);
}

export function isMissingCatalogSkill(
	id: string,
	env: Record<string, string | undefined> = process.env,
): boolean {
	loadMissingCatalogDisk(env);
	return missingCatalogKeys.has(normalizeCatalogKey(id));
}

export function clearGithubSkillFolderCache(
	env: Record<string, string | undefined> = process.env,
): void {
	githubFolderCache.clear();
	missingCatalogKeys.clear();
	githubFolderDiskLoaded = false;
	missingCatalogDiskLoaded = false;
	for (const path of [githubFoldersPath(env), missingCatalogPath(env)]) {
		try {
			if (existsSync(path)) rmSync(path);
		} catch {
			// Ignore an unwritable cache file.
		}
	}
}

async function githubSkillFolders(
	source: string,
	fetchFn: FetchLike,
): Promise<string[] | undefined> {
	loadGithubFolderDisk();
	if (githubFolderCache.has(source)) return githubFolderCache.get(source);
	const parsed = parseSkillSource(source);
	if (!parsed || "error" in parsed || "url" in parsed) return undefined;
	try {
		const treeUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${parsed.ref}?recursive=1`;
		const res = await fetchFn(treeUrl, {
			headers: {
				accept: "application/vnd.github+json",
				"user-agent": "caelence-harness",
			},
		});
		if (!res.ok) return undefined;
		const data = (await res.json()) as { tree?: Array<{ path?: string; type?: string }> };
		if (!Array.isArray(data.tree)) return undefined;
		const folders = uniqueSkillFolders(
			productionSkillFiles(
				data.tree
					.map((node) => node.path ?? "")
					.filter((path) => path.endsWith("/SKILL.md") || path === "SKILL.md"),
			),
			parsed.repo,
		);
		rememberGithubSkillFolders(source, folders);
		return folders;
	} catch {
		return undefined;
	}
}

function catalogHitName(hit: RegistryHit): string {
	return (hit.name || skillNameFromCatalogId(hit.id)).trim().toLowerCase();
}

function meaningfulSkillTokens(name: string): string[] {
	return name
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 2 && !GENERIC_SKILL_TOKENS.has(token));
}

function yamlNameLikeness(wanted: string, folder: string): number {
	const key = folder.toLowerCase();
	if (key === wanted) return 1000;
	let score = 0;
	if (wanted.endsWith("-v1") && key.endsWith("-v1")) score += 4;
	for (const token of meaningfulSkillTokens(wanted)) {
		if (key === token || key.endsWith(`-${token}`) || key.startsWith(`${token}-`)) score += 12;
		else if (key.includes(token)) score += 8;
	}
	return score;
}

/** Folder name, single-skill repo, or a non-generic token shared with a folder. */
export function catalogNameFitsGithubFolders(wanted: string, folders: string[]): boolean {
	const name = wanted.trim().toLowerCase();
	if (!name || folders.length === 0) return false;
	if (folders.some((folder) => folder.toLowerCase() === name)) return true;
	if (folders.length === 1) return true;
	const tokens = meaningfulSkillTokens(name);
	if (tokens.length === 0) return false;
	return folders.some((folder) => yamlNameLikeness(name, folder) > 0);
}

function catalogHitIsInstallable(hit: RegistryHit, folders: string[] | undefined): boolean {
	if (
		isMissingCatalogSkill(skillCatalogRef(hit)) ||
		isMissingCatalogSkill(`${hit.source}/${hit.name}`)
	) {
		return false;
	}
	if (!folders) return true;
	return catalogNameFitsGithubFolders(catalogHitName(hit), folders);
}

/** Drop skills.sh rows we already know are missing from that GitHub repo. */
export function dropUninstallableCatalogHits(hits: RegistryHit[]): RegistryHit[] {
	loadGithubFolderDisk();
	loadMissingCatalogDisk();
	return hits.filter((hit) => catalogHitIsInstallable(hit, githubFolderCache.get(hit.source)));
}

/** Drop skills.sh rows whose named skill is not in that GitHub repo. */
export async function filterGithubCatalogHits(
	hits: RegistryHit[],
	fetchFn: FetchLike,
): Promise<RegistryHit[]> {
	const sources = [
		...new Set(hits.map((hit) => hit.source).filter((source) => source.includes("/"))),
	];
	const foldersBySource = new Map<string, string[] | undefined>();
	await Promise.all(
		sources.map(async (source) => {
			foldersBySource.set(source, await githubSkillFolders(source, fetchFn));
		}),
	);
	return hits.filter((hit) => catalogHitIsInstallable(hit, foldersBySource.get(hit.source)));
}

/** True when this loaded skill is the catalog row, not another skill with the same name. */
export function skillIsCatalogHit(
	skill: { name: string; source: string; catalogRef?: string },
	hit: RegistryHit,
): boolean {
	const keys = [
		skillCatalogRef(hit),
		hit.id,
		`${hit.source}/${hit.name}`,
		`${hit.source}@${hit.name}`,
	];
	if (skill.catalogRef) {
		return keys.some((key) => catalogRefsMatch(skill.catalogRef ?? "", key));
	}
	if (skill.source === "user") {
		return (
			skill.name.toLowerCase() === hit.name.toLowerCase() &&
			(hit.source === "user" || hit.source === "project")
		);
	}
	if (hit.source !== "bundled") return false;
	return skill.name.toLowerCase() === hit.name.toLowerCase();
}

export function findSkillForCatalogId<
	T extends { name: string; source: string; catalogRef?: string },
>(skills: readonly T[], id: string): T | undefined {
	const wanted = id.trim();
	if (!wanted) return undefined;
	const byRef = skills.find(
		(skill) => skill.catalogRef && catalogRefsMatch(skill.catalogRef, wanted),
	);
	if (byRef) return byRef;
	const name = skillNameFromCatalogId(wanted).toLowerCase();
	if (!name) return undefined;
	if (isBundledCatalogId(wanted)) {
		return skills.find((skill) => skill.name.toLowerCase() === name);
	}
	return undefined;
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
	const want = Math.min(Math.max(options.limit ?? 10, 1), 20);
	const url = `${SEARCH_URL}/api/search?${new URLSearchParams({ q, limit: String(want) }).toString()}`;
	const res = await fetchFn(url, { headers: { accept: "application/json" } });
	if (!res.ok) throw new Error(`skills.sh search failed (${res.status})`);
	const data = (await res.json()) as {
		skills?: Array<{ id?: string; name?: string; source?: string; installs?: number }>;
	};
	const mapped = (data.skills ?? [])
		.map((row) => ({
			id: String(row.id ?? row.name ?? ""),
			name: String(row.name ?? row.id ?? ""),
			source: String(row.source ?? ""),
			...(typeof row.installs === "number" ? { installs: row.installs } : {}),
		}))
		.filter((row) => row.name && row.source && isInstallableSkillsShHit(row));
	return filterGithubCatalogHits(mapped, fetchFn);
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
	let catalogRef = `${parsed.owner}/${parsed.repo}`;
	if (input.source.includes("@")) catalogRef = input.source;
	else if (skill) catalogRef = `${parsed.owner}/${parsed.repo}@${skill}`;
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

const NOISE_SKILL_DIRS = new Set([
	"node_modules",
	"examples",
	"example",
	"test",
	"tests",
	"__tests__",
	"fixtures",
]);

function isNoiseSkillPath(path: string): boolean {
	return path.split("/").some((part) => NOISE_SKILL_DIRS.has(part));
}

function skillFolderName(path: string, repo: string): string {
	return dirname(path) === "." ? repo : (dirname(path).split("/").pop() ?? path);
}

function uniqueSkillFolders(paths: string[], repo: string): string[] {
	const seen = new Set<string>();
	const folders: string[] = [];
	for (const path of paths) {
		const folder = skillFolderName(path, repo);
		const key = folder.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		folders.push(folder);
	}
	return folders.toSorted((a, b) => a.localeCompare(b));
}

function productionSkillFiles(skillFiles: string[]): string[] {
	const filtered = skillFiles.filter((path) => !isNoiseSkillPath(path));
	return filtered.length > 0 ? filtered : skillFiles;
}

function skillPathMatches(path: string, wanted: string, input: ParsedSkillSource): boolean {
	const folder = skillFolderName(path, input.repo);
	if (folder.toLowerCase() !== wanted) return false;
	const prefix = trimTrailingSlashes(input.path?.toLowerCase() ?? "");
	if (!prefix.includes("/")) return true;
	const lower = path.toLowerCase();
	return lower === `${prefix}/skill.md` || lower.startsWith(`${prefix}/`);
}

function pickSkillMd(matches: string[]): string {
	const rank = (path: string): number => {
		const lower = path.toLowerCase();
		if (lower === "skill.md") return 0;
		if (/^skills\/[^/]+\/skill\.md$/.test(lower)) return 1;
		if (/^\.github\/skills\/[^/]+\/skill\.md$/.test(lower)) return 2;
		if (/^\.cursor\/skills\/[^/]+\/skill\.md$/.test(lower)) return 3;
		if (/^\.claude\/skills\/[^/]+\/skill\.md$/.test(lower)) return 4;
		if (!path.startsWith(".")) return 5;
		return 6;
	};
	const ranked = matches.toSorted(
		(a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b),
	);
	return ranked[0] ?? "";
}

function isSkillPayloadFile(path: string, skillMd: string): boolean {
	return path.endsWith(".md") || path.endsWith(".txt") || path === skillMd;
}

function selectSkillPayloadFiles(files: string[], skillMd: string): string[] {
	const unique = [...new Set(files.filter((path) => isSkillPayloadFile(path, skillMd)))];
	const rank = (path: string): number => {
		const base = path.split("/").pop() ?? "";
		const lower = path.toLowerCase();
		if (path === skillMd) return 0;
		if (/^license(\.txt|\.md)?$/i.test(base)) return 1;
		if (lower.includes("/reference/") || lower.includes("/references/")) return 2;
		return 3;
	};
	return unique
		.toSorted((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b))
		.slice(0, MAX_FILES);
}

async function yamlNameForSkillMd(
	path: string,
	input: ParsedSkillSource & { fetchFn: FetchLike },
): Promise<string> {
	const raw = `https://raw.githubusercontent.com/${input.owner}/${input.repo}/${input.ref}/${path}`;
	const file = await input.fetchFn(raw, { headers: { "user-agent": "caelence-harness" } });
	if (!file.ok) return "";
	const markdown = await file.text();
	return parseSkillMarkdown(markdown, "SKILL.md", ".").name.trim().toLowerCase();
}

async function resolveGithubSkillMatches(input: {
	files: string[];
	wanted?: string;
	input: ParsedSkillSource & { fetchFn: FetchLike };
}): Promise<string[]> {
	const { files, wanted } = input;
	const repo = input.input.repo;
	if (!wanted) return files;
	const byFolder = files.filter((path) => skillPathMatches(path, wanted, input.input));
	if (byFolder.length > 0) return byFolder;
	const folders = uniqueSkillFolders(files, repo);
	const ranked = [...folders].sort(
		(a, b) => yamlNameLikeness(wanted, b) - yamlNameLikeness(wanted, a) || a.localeCompare(b),
	);
	for (const folder of ranked.slice(0, YAML_NAME_SCAN_LIMIT)) {
		const candidates = files.filter(
			(path) => skillFolderName(path, repo).toLowerCase() === folder.toLowerCase(),
		);
		const md = pickSkillMd(candidates);
		if (!md) continue;
		const yamlName = await yamlNameForSkillMd(md, input.input);
		if (yamlName === wanted) return candidates;
	}
	if (folders.length === 1) {
		const only = folders[0]?.toLowerCase();
		return files.filter((path) => skillFolderName(path, repo).toLowerCase() === only);
	}
	return [];
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
	const catalogFiles = productionSkillFiles(
		(data.tree ?? [])
			.map((node) => node.path ?? "")
			.filter((path) => path.endsWith("/SKILL.md") || path === "SKILL.md"),
	);
	if (catalogFiles.length === 0) return { error: `No SKILL.md in ${input.owner}/${input.repo}` };

	const wanted = input.skill?.toLowerCase() || input.path?.split("/").pop()?.toLowerCase();
	const matches = await resolveGithubSkillMatches({
		files: catalogFiles,
		wanted,
		input,
	});
	const choices = uniqueSkillFolders(catalogFiles, input.repo);
	rememberGithubSkillFolders(`${input.owner}/${input.repo}`, choices);

	if (matches.length === 0) {
		const ref =
			input.catalogRef?.trim() || (wanted ? `${input.owner}/${input.repo}@${wanted}` : "");
		if (ref) rememberMissingCatalogSkill(ref);
		return {
			error: `No skill ${JSON.stringify(input.skill)} in ${input.owner}/${input.repo}.`,
			choices,
		};
	}
	if (!wanted && uniqueSkillFolders(matches, input.repo).length > 1) {
		return {
			error: "Repo has several skills. Add @name.",
			choices,
		};
	}

	const skillMd = pickSkillMd(matches);
	const root = dirname(skillMd) === "." ? "" : dirname(skillMd);
	const files = selectSkillPayloadFiles(
		(data.tree ?? [])
			.map((node) => node.path ?? "")
			.filter(
				(path) =>
					path && (root ? path === root || path.startsWith(`${root}/`) : path === "SKILL.md"),
			),
		skillMd,
	);
	if (files.length === 0) return { error: "Skill has no installable files." };

	const downloaded = await downloadSkillFiles(input, files, skillMd, root);
	if ("error" in downloaded) return downloaded;
	const markdown = downloaded.files["SKILL.md"];
	if (!markdown) return { error: "Could not download SKILL.md." };
	const name = parseSkillMarkdown(markdown, "SKILL.md", ".").name;
	const catalogRef =
		input.catalogRef?.trim() ||
		(input.skill ? `${input.owner}/${input.repo}@${input.skill}` : undefined);
	return writeSkillDir(input.destRoot, name, downloaded.files, catalogRef);
}

async function downloadSkillFiles(
	input: ParsedSkillSource & { fetchFn: FetchLike },
	files: string[],
	skillMd: string,
	root: string,
): Promise<{ files: Record<string, string> } | { error: string }> {
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
	return { files: downloaded };
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
	const dest = join(destRoot, skillInstallDirName(slug, catalogRef));
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
	return { name: slug, rel: `${skillInstallDirName(slug, catalogRef)}/SKILL.md` };
}

function catalogRefInDir(dir: string): string {
	const path = join(dir, SKILL_CATALOG_REF_FILE);
	if (!existsSync(path)) return "";
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return "";
	}
}

function catalogDirMatches(
	stored: string,
	wanted: string,
	precise: boolean,
	wantedName: string,
): boolean {
	if (!stored) return false;
	if (precise) return catalogRefsMatch(stored, wanted);
	return skillNameFromCatalogId(stored).toLowerCase() === wantedName;
}

function collectInstalledSkillDirs(destRoot: string, wanted: string): string[] {
	const precise = wanted.includes("/") || wanted.includes("@");
	const wantedName = skillNameFromCatalogId(wanted).toLowerCase();
	const folders = new Set<string>();
	const bySlug = join(destRoot, skillInstallDirName(wantedName, precise ? wanted : undefined));
	const byName = join(destRoot, slugifySkillId(wantedName));
	if (existsSync(bySlug)) folders.add(bySlug);
	if (existsSync(byName)) folders.add(byName);
	if (!existsSync(destRoot)) return [...folders];
	for (const entry of readdirSync(destRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dir = join(destRoot, entry.name);
		if (catalogDirMatches(catalogRefInDir(dir), wanted, precise, wantedName)) folders.add(dir);
	}
	return [...folders];
}

export function removeInstalledSkill(
	destRoot: string,
	name: string,
): { removed: boolean; reason?: string } {
	const wanted = name.trim();
	if (!wanted) return { removed: false, reason: "Name is empty." };
	const folders = collectInstalledSkillDirs(destRoot, wanted);
	if (folders.length === 0) return { removed: false, reason: "Not installed." };
	try {
		for (const dir of folders) rmSync(dir, { recursive: true, force: true });
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
