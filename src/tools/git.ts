import {
	errorResult,
	jsonResult,
	type McpToolDefinition,
	READ_ONLY_ANNOTATIONS,
	textResult,
} from "../core/mcp.ts";
import { resolveUnderCwd } from "./paths.ts";

const GIT_TIMEOUT_MS = 30_000;

async function git(
	cwd: string,
	args: string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GIT_EDITOR: "true", GIT_TERMINAL_PROMPT: "0" },
	});
	const timer = setTimeout(() => proc.kill(), GIT_TIMEOUT_MS);
	try {
		const [stdout, stderr, exit] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { exit, stdout: stdout.slice(0, 32_000), stderr: stderr.slice(0, 8_000) };
	} finally {
		clearTimeout(timer);
	}
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function createGitTools(cwd: string): McpToolDefinition[] {
	return [
		{
			name: "git_status",
			description: "Show branch and porcelain status. Prefer this over exec git status.",
			annotations: READ_ONLY_ANNOTATIONS,
			inputSchema: { type: "object", properties: {} },
			async handler() {
				const result = await git(cwd, ["status", "--porcelain=v1", "-b"]);
				if (result.exit !== 0) return errorResult(result.stderr.trim() || "git status failed");
				return textResult(result.stdout || "clean");
			},
		},
		{
			name: "git_diff",
			description: "Show the working tree or staged diff. Optional project-relative path.",
			annotations: READ_ONLY_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					path: { type: "string" },
					staged: { type: "boolean" },
				},
			},
			async handler(raw) {
				const args = ["diff"];
				if (raw.staged === true) args.push("--cached");
				if (typeof raw.path === "string" && raw.path.trim()) {
					try {
						resolveUnderCwd(cwd, raw.path);
					} catch (err) {
						return errorResult(err instanceof Error ? err.message : String(err));
					}
					args.push("--", raw.path.trim());
				}
				const result = await git(cwd, args);
				if (result.exit !== 0) return errorResult(result.stderr.trim() || "git diff failed");
				return textResult(result.stdout || "no diff");
			},
		},
		{
			name: "git_log",
			description: "Recent commits, oneline. Default 20.",
			annotations: READ_ONLY_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					max: { type: "number", description: "Commit cap (default 20, max 50)." },
				},
			},
			async handler(raw) {
				const max =
					typeof raw.max === "number" && Number.isFinite(raw.max)
						? Math.min(50, Math.max(1, Math.floor(raw.max)))
						: 20;
				const result = await git(cwd, ["log", `-n${max}`, "--oneline"]);
				if (result.exit !== 0) return errorResult(result.stderr.trim() || "git log failed");
				return textResult(result.stdout || "no commits");
			},
		},
		{
			name: "git_commit",
			description:
				"Commit already-staged files, or the listed project-relative paths. Does not push. Requires approval.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
			inputSchema: {
				type: "object",
				properties: {
					message: { type: "string" },
					paths: { type: "array", items: { type: "string" } },
				},
				required: ["message"],
			},
			async handler(raw) {
				const message = asString(raw.message).trim();
				if (!message) return errorResult("message is empty");
				const paths = Array.isArray(raw.paths)
					? raw.paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
					: [];
				for (const path of paths) {
					try {
						resolveUnderCwd(cwd, path);
					} catch (err) {
						return errorResult(err instanceof Error ? err.message : String(err));
					}
				}
				if (paths.length > 0) {
					const add = await git(cwd, ["add", "--", ...paths]);
					if (add.exit !== 0) return errorResult(add.stderr.trim() || "git add failed");
				}
				const result = await git(cwd, ["commit", "-m", message]);
				if (result.exit !== 0)
					return errorResult(result.stderr.trim() || result.stdout.trim() || "git commit failed");
				return jsonResult({ committed: true, message, stdout: result.stdout.trim() });
			},
		},
	];
}
