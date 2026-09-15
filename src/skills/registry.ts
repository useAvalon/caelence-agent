import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { listBundledSkills, parseSkillMarkdown } from "./loader.ts";

/** Bare names that install more than one catalog folder. */
export const BUNDLED_PACKS: Record<string, readonly string[]> = {
	copy: ["copywriting", "copy-rmbc", "copy-harry-dry", "copy-editor"],
	copywriting: ["copywriting", "copy-rmbc", "copy-harry-dry", "copy-editor"],
};

const SEARCH_URL = (process.env.SKILLS_API_URL?.trim() || "https://skills.sh").replace(/\/+$/, "");
const MAX_FILES = 40;
const MAX_FILE_BYTES = 512 * 1024;

export interface RegistryHit {
	name: string;
	source: string;
	installs?: number;
	id: string;
}

export interface ParsedSkillSource {
	owner: string;
	repo: string;
	skill?: string;
	path?: string;
	ref: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function parseSkillSource(
	raw: string,
): ParsedSkillSource | { url: string } | { error: string } {
	const value = raw.trim();
	if (!value) return { error: "Source is empty." };

	const skillsSh = /^https?:\/\/(?:www\.)?skills\.sh\/([^?#]+)$/i.exec(value);
	if (skillsSh?.[1]?.includes("/")) {
		return parseSkillSource(skillsSh[1].replace(/\/+$/, ""));
	}

	if (/^https?:\/\//i.test(value)) {
		const github =
			/^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.*))?)?/i.exec(
				value,
			);
		if (github) {
			const path = github[4]?.replace(/\/SKILL\.md$/i, "").replace(/\/+$/, "");
			return {
				owner: github[1] ?? "",
				repo: (github[2] ?? "").replace(/\.git$/, ""),
				ref: github[3] || "HEAD",
				...(path ? { path } : {}),
				...(path ? { skill: path.split("/").pop() } : {}),
			};
		}
		const rawGh = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/i.exec(
			value,
		);
		if (rawGh) {
			const path = (rawGh[4] ?? "").replace(/\/SKILL\.md$/i, "");
			return {
				owner: rawGh[1] ?? "",
				repo: rawGh[2] ?? "",
				ref: rawGh[3] || "HEAD",
				...(path ? { path } : {}),
			};
		}
		return { url: value };
	}

	const at = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)@([A-Za-z0-9_./-]+)$/.exec(value);
	if (at) {
		return { owner: at[1] ?? "", repo: at[2] ?? "", skill: at[3], ref: "HEAD" };
	}
	const repo = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/(.+))?$/.exec(value);
	if (repo) {
		const path = repo[3]?.replace(/\/+$/, "");
		return {
			owner: repo[1] ?? "",
			repo: repo[2] ?? "",
			ref: "HEAD",
			...(path ? { path, skill: path.split("/").pop() } : {}),
		};
	}
	return {
		error: "Use a bundled name, owner/repo, owner/repo@skill, or a GitHub / skills.sh URL.",
	};
}

export function parseBundledSkillRef(raw: string): string | undefined {
	const value = raw.trim();
	if (!value) return undefined;
	const tagged = /^(?:bundled[@/])([A-Za-z0-9_.-]+)$/i.exec(value);
	if (tagged?.[1]) return tagged[1];
	if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
	return undefined;
}

export function bundledInstallNames(name: string): string[] | undefined {
	const key = name.trim().toLowerCase();
	if (!key) return undefined;
	const pack = BUNDLED_PACKS[key];
	if (pack) return [...pack];
	const found = listBundledSkills().find((skill) => skill.name.toLowerCase() === key);
	return found ? [found.name] : undefined;
}

export function bundledRegistryHits(query: string): RegistryHit[] {
	const q = query.trim().toLowerCase();
	const seen = new Set<string>();
	const hits: RegistryHit[] = [];
	for (const pack of Object.keys(BUNDLED_PACKS)) {
		if (pack === "copy") continue;
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
		hits.push({ id: `bundled/${pack}`, name: pack, source: "bundled" });
	}
	for (const skill of listBundledSkills()) {
		const key = skill.name.toLowerCase();
		if (q && q !== "bundled" && !key.includes(q)) continue;
		if (seen.has(key)) continue;
		seen.add(key);
		hits.push({ id: `bundled/${skill.name}`, name: skill.name, source: "bundled" });
	}
	return hits;
}

export function formatBundledHits(hits: RegistryHit[]): string {
	return hits.map((hit) => `bundled@${hit.name}`).join("\n");
}

export async function searchSkills(query: string, fetchFn: FetchLike = fetch): Promise<string> {
	const bundled = formatBundledHits(bundledRegistryHits(query));
	try {
		const remote = await searchSkillsSh(query, fetchFn);
		const remoteText = remote.length > 0 ? formatRegistryHits(remote) : "";
		return [bundled, remoteText].filter(Boolean).join("\n") || "No matches.";
	} catch (err) {
		if (bundled) return bundled;
		return err instanceof Error ? err.message : String(err);
	}
}

export function installBundledSkills(
	name: string,
	destRoot: string,
): { name: string; rel: string; installed: string[] } | { error: string; choices?: string[] } {
	const names = bundledInstallNames(name);
	const catalog = listBundledSkills();
	if (!names) {
		const choices = [
			...Object.keys(BUNDLED_PACKS).filter((key) => key !== "copy"),
			...catalog.map((skill) => skill.name),
		].filter((value, index, all) => all.indexOf(value) === index);
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
		} catch (err) {
			return { error: err instanceof Error ? err.message : String(err) };
		}
		installed.push(slug);
	}
	const first = installed[0] ?? name;
	return { name: first, rel: `${first}/SKILL.md`, installed };
}

export async function searchSkillsSh(
	query: string,
	fetchFn: FetchLike = fetch,
): Promise<RegistryHit[]> {
	const q = query.trim();
	if (!q) return [];
	const url = `${SEARCH_URL}/api/search?${new URLSearchParams({ q, limit: "10" }).toString()}`;
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
	return installFromGithub({
		...parsed,
		skill,
		destRoot: input.destRoot,
		fetchFn: input.fetchFn ?? fetch,
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

async function installFromGithub(
	input: ParsedSkillSource & {
		destRoot: string;
		fetchFn: FetchLike;
		skill?: string;
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
		? skillFiles.filter((path) => {
				const folder = dirname(path) === "." ? input.repo : dirname(path).split("/").pop();
				return (
					folder?.toLowerCase() === wanted ||
					path.toLowerCase() === `${wanted}/skill.md` ||
					path.toLowerCase().endsWith(`/${wanted}/skill.md`) ||
					(input.path && path.toLowerCase().startsWith(`${input.path.toLowerCase()}/`))
				);
			})
		: skillFiles;

	if (matches.length === 0) {
		return {
			error: `No skill ${JSON.stringify(input.skill)} in ${input.owner}/${input.repo}.`,
			choices: skillFiles.map((path) =>
				dirname(path) === "." ? input.repo : (dirname(path).split("/").pop() ?? path),
			),
		};
	}
	if (matches.length > 1 && !wanted) {
		return {
			error: "Repo has several skills. Add @name.",
			choices: matches.map((path) =>
				dirname(path) === "." ? input.repo : (dirname(path).split("/").pop() ?? path),
			),
		};
	}

	const skillMd = matches[0] ?? "";
	const root = dirname(skillMd) === "." ? "" : dirname(skillMd);
	const files = (data.tree ?? [])
		.map((node) => node.path ?? "")
		.filter(
			(path) => path && (root ? path === root || path.startsWith(`${root}/`) : path === "SKILL.md"),
		);
	if (files.length > MAX_FILES) return { error: `Skill has more than ${MAX_FILES} files.` };

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
	const markdown = downloaded["SKILL.md"];
	if (!markdown) return { error: "Could not download SKILL.md." };
	const name = parseSkillMarkdown(markdown, "SKILL.md", ".").name;
	return writeSkillDir(input.destRoot, name, downloaded);
}

function writeSkillDir(
	destRoot: string,
	name: string,
	files: Record<string, string>,
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
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
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
		return { removed: false, reason: err instanceof Error ? err.message : String(err) };
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
