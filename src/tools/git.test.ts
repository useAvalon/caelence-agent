import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer } from "../core/mcp.ts";
import { createGitTools } from "./git.ts";

async function git(cwd: string, args: string[]): Promise<void> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GIT_EDITOR: "true", GIT_TERMINAL_PROMPT: "0" },
	});
	const exit = await proc.exited;
	if (exit !== 0) {
		const err = await new Response(proc.stderr).text();
		throw new Error(err || `git ${args.join(" ")} failed`);
	}
}

async function repo(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), "harness-git-"));
	const template = await mkdtemp(join(tmpdir(), "harness-git-template-"));
	try {
		await git(cwd, ["init", `--template=${template}`]);
	} finally {
		await rm(template, { recursive: true, force: true });
	}
	await git(cwd, ["config", "user.email", "harness@example.com"]);
	await git(cwd, ["config", "user.name", "Harness"]);
	return cwd;
}

describe("git tools", () => {
	test("status, diff, log, and path-bound commit", async () => {
		const cwd = await repo();
		try {
			const mcp = createMcpServer(createGitTools(cwd));
			await writeFile(join(cwd, "a.txt"), "one\n", "utf8");
			const status = await mcp.callTool("git_status", {});
			expect(status.isError).toBeFalsy();
			expect(status.content[0]?.text).toContain("a.txt");

			const denied = await mcp.callTool("git_diff", { path: "../secret" });
			expect(denied.isError).toBe(true);

			const commitEscape = await mcp.callTool("git_commit", {
				message: "nope",
				paths: ["../secret"],
			});
			expect(commitEscape.isError).toBe(true);

			const committed = await mcp.callTool("git_commit", {
				message: "add a",
				paths: ["a.txt"],
			});
			expect(committed.isError).toBeFalsy();
			expect(committed.structuredContent).toMatchObject({ committed: true, message: "add a" });

			await writeFile(join(cwd, "b.txt"), "two\n", "utf8");
			const empty = await mcp.callTool("git_commit", { message: "nothing staged" });
			expect(empty.isError).toBe(true);

			const log = await mcp.callTool("git_log", { max: 5 });
			expect(log.content[0]?.text).toContain("add a");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
