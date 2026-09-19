import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Glob } from "bun";
import {
	createMcpServer,
	errorResult,
	jsonResult,
	type McpServer,
	type McpToolDefinition,
	READ_ONLY_ANNOTATIONS,
	textResult,
} from "../core/mcp.ts";
import { PathEscapeError, resolveUnderCwd, shouldSkipDir, toProjectRel } from "./paths.ts";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const EXEC_TIMEOUT_MS = 120_000;

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

async function readUtf8(abs: string): Promise<string> {
	const info = await stat(abs);
	if (!info.isFile()) throw new Error(`Not a file: ${abs}`);
	if (info.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} bytes`);
	return readFile(abs, "utf8");
}

export interface LocalToolsOptions {
	cwd: string;
	extraWriteAbsolutes?: () => readonly string[];
}

function expandUserPath(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return path;
}

function resolveToolPath(cwd: string, rel: string, extra: ReadonlySet<string>): string {
	const trimmed = rel.trim();
	if (trimmed.startsWith("~") || isAbsolute(trimmed)) {
		const abs = resolve(expandUserPath(trimmed));
		if (extra.has(abs)) return abs;
		throw new PathEscapeError(rel);
	}
	return resolveUnderCwd(cwd, rel);
}

function toolError(err: unknown): ReturnType<typeof errorResult> {
	return errorResult(err instanceof Error ? err.message : String(err));
}

function skipsPath(rel: string): boolean {
	return rel.split("/").some((part) => shouldSkipDir(part));
}

async function globProjectFiles(
	cwd: string,
	pattern: string,
): Promise<{ matches: string[]; truncated: boolean }> {
	const glob = new Glob(pattern);
	const matches: string[] = [];
	for await (const path of glob.scan({ cwd, onlyFiles: true, dot: false })) {
		if (skipsPath(path)) continue;
		matches.push(path);
		if (matches.length >= 500) break;
	}
	matches.sort((left, right) => left.localeCompare(right));
	return { matches, truncated: matches.length >= 500 };
}

function lineMatches(line: string, pattern: string, re: RegExp | null): boolean {
	return re ? re.test(line) : line.includes(pattern);
}

function collectLineHits(
	rel: string,
	content: string,
	pattern: string,
	re: RegExp | null,
	hits: Array<{ path: string; line: number; text: string }>,
	maxMatches: number,
): boolean {
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (!lineMatches(line, pattern, re)) continue;
		hits.push({ path: rel, line: i + 1, text: line.slice(0, 240) });
		if (hits.length >= maxMatches) return true;
	}
	return false;
}

async function readFileIfPresent(abs: string): Promise<string | undefined> {
	try {
		return await readFile(abs, "utf8");
	} catch {
		return undefined;
	}
}

async function grepProjectFiles(
	cwd: string,
	pattern: string,
	fileGlob: string,
	useRegex: boolean,
	maxMatches: number,
): Promise<{ hits: Array<{ path: string; line: number; text: string }>; truncated: boolean }> {
	const re = useRegex ? new RegExp(pattern) : null;
	const hits: Array<{ path: string; line: number; text: string }> = [];
	const glob = new Glob(fileGlob);
	for await (const rel of glob.scan({ cwd, onlyFiles: true, dot: false })) {
		if (skipsPath(rel)) continue;
		const content = await readFileIfPresent(join(cwd, rel));
		if (content === undefined) continue;
		if (collectLineHits(rel, content, pattern, re, hits, maxMatches)) {
			return { hits, truncated: true };
		}
	}
	return { hits, truncated: false };
}

export function createLocalTools(options: LocalToolsOptions): McpServer {
	const cwd = options.cwd;
	const extras = (): ReadonlySet<string> =>
		new Set((options.extraWriteAbsolutes?.() ?? []).map((path) => resolve(expandUserPath(path))));

	const tools: McpToolDefinition[] = [
		{
			name: "read_file",
			description:
				"Read a UTF-8 file under the project root. Prefer this over exec for inspecting source.",
			annotations: READ_ONLY_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					path: { type: "string", description: "Project-relative file path." },
				},
				required: ["path"],
			},
			async handler(raw) {
				try {
					const extra = extras();
					const abs = resolveToolPath(cwd, asString(raw.path), extra);
					const content = await readUtf8(abs);
					return textResult(content);
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
		{
			name: "write_file",
			description:
				"Create or overwrite a whole file under the project root (up to 10 MB). Prefer edit_file for a small change. Call this to apply the write. Do not tell the user the file is saved until this tool succeeds.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
			inputSchema: {
				type: "object",
				properties: {
					path: { type: "string", description: "Project-relative file path." },
					content: { type: "string", description: "UTF-8 file contents." },
				},
				required: ["path", "content"],
			},
			async handler(raw) {
				try {
					const extra = extras();
					const abs = resolveToolPath(cwd, asString(raw.path), extra);
					const content = asString(raw.content);
					if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
						return errorResult(`File exceeds ${MAX_FILE_BYTES} bytes`);
					}
					await mkdir(dirname(abs), { recursive: true });
					await writeFile(abs, content, "utf8");
					return jsonResult({
						path: extra.has(abs) ? abs : toProjectRel(cwd, abs),
						bytes: Buffer.byteLength(content, "utf8"),
					});
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
		{
			name: "edit_file",
			description:
				"Replace an exact snippet in an existing file. old_str must match uniquely unless replace_all is true. Call this to apply the edit. Do not tell the user the file is changed until this tool succeeds.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: false,
			},
			inputSchema: {
				type: "object",
				properties: {
					path: { type: "string", description: "Project-relative path of an existing file." },
					old_str: { type: "string", description: "Exact snippet to replace." },
					new_str: { type: "string", description: "Replacement snippet." },
					replace_all: {
						type: "boolean",
						description: "Replace every occurrence (default false).",
					},
				},
				required: ["path", "old_str", "new_str"],
			},
			async handler(raw) {
				try {
					const extra = extras();
					const abs = resolveToolPath(cwd, asString(raw.path), extra);
					const oldStr = asString(raw.old_str);
					const newStr = asString(raw.new_str);
					if (!oldStr) return errorResult("old_str is empty");
					const original = await readUtf8(abs);
					const replaceAll = raw.replace_all === true;
					if (!original.includes(oldStr)) {
						return errorResult("old_str was not found in the file");
					}
					if (!replaceAll) {
						const first = original.indexOf(oldStr);
						const second = original.indexOf(oldStr, first + oldStr.length);
						if (second >= 0) {
							return errorResult(
								"old_str matches more than once; pass replace_all or a unique snippet",
							);
						}
					}
					const next = replaceAll
						? original.split(oldStr).join(newStr)
						: original.replace(oldStr, newStr);
					await writeFile(abs, next, "utf8");
					return jsonResult({
						path: extra.has(abs) ? abs : toProjectRel(cwd, abs),
						replaced: replaceAll ? "all" : "one",
					});
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
		{
			name: "glob",
			description: "List project-relative file paths matching a glob pattern (e.g. **/*.ts).",
			annotations: READ_ONLY_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					pattern: { type: "string", description: "Glob pattern relative to the project root." },
				},
				required: ["pattern"],
			},
			async handler(raw) {
				try {
					const pattern = asString(raw.pattern) || "**/*";
					const found = await globProjectFiles(cwd, pattern);
					return jsonResult({ pattern, matches: found.matches, truncated: found.truncated });
				} catch (err) {
					return toolError(err);
				}
			},
		},
		{
			name: "grep",
			description: "Search file contents under the project root. Prefer this over exec for search.",
			annotations: READ_ONLY_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					pattern: { type: "string", description: "Literal substring or regex." },
					glob: { type: "string", description: "Optional file glob (default **/*)." },
					regex: { type: "boolean", description: "Treat pattern as a regular expression." },
					max_matches: { type: "number", description: "Cap on matches (default 100)." },
				},
				required: ["pattern"],
			},
			async handler(raw) {
				try {
					const pattern = asString(raw.pattern);
					if (!pattern) return errorResult("pattern is empty");
					const found = await grepProjectFiles(
						cwd,
						pattern,
						asString(raw.glob) || "**/*",
						raw.regex === true,
						typeof raw.max_matches === "number" ? raw.max_matches : 100,
					);
					return jsonResult({ pattern, hits: found.hits, truncated: found.truncated });
				} catch (err) {
					return toolError(err);
				}
			},
		},
		{
			name: "exec",
			description:
				"Run a shell command in the project root. Times out after 120 seconds. Do not use exec to read or search files.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
			inputSchema: {
				type: "object",
				properties: {
					command: { type: "string", description: "The shell command to run." },
					cwd: { type: "string", description: "Optional project-relative working directory." },
				},
				required: ["command"],
			},
			async handler(raw) {
				try {
					const command = asString(raw.command);
					if (!command.trim()) return errorResult("command is empty");
					let workdir = cwd;
					if (typeof raw.cwd === "string" && raw.cwd.trim()) {
						workdir = resolveUnderCwd(cwd, raw.cwd);
					}
					const proc = Bun.spawn(["/bin/sh", "-lc", command], {
						cwd: workdir,
						stdout: "pipe",
						stderr: "pipe",
					});
					const timer = setTimeout(() => proc.kill(), EXEC_TIMEOUT_MS);
					const [stdout, stderr, exit] = await Promise.all([
						new Response(proc.stdout).text(),
						new Response(proc.stderr).text(),
						proc.exited,
					]);
					clearTimeout(timer);
					const payload = {
						exit,
						stdout: stdout.slice(0, 32_000),
						stderr: stderr.slice(0, 32_000),
					};
					return jsonResult(payload, exit !== 0);
				} catch (err) {
					if (err instanceof PathEscapeError) return errorResult(err.message);
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
	];

	return createMcpServer(tools);
}
