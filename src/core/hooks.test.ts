import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHookRunner } from "./hooks.ts";

describe("hooks", () => {
	test("pre_tool nonzero exit denies the call", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-hooks-"));
		try {
			const hooks = createHookRunner({
				cwd,
				hooks: [{ event: "pre_tool", command: "printf 'blocked by hook' >&2; exit 2" }],
			});
			const result = await hooks.preTool("write_file", { path: "a.ts" });
			expect(result.allow).toBe(false);
			expect(result.reason).toContain("blocked by hook");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("pre_tool zero exit allows", async () => {
		const hooks = createHookRunner({
			cwd: process.cwd(),
			hooks: [{ event: "pre_tool", command: "exit 0" }],
		});
		expect(await hooks.preTool("read_file", {})).toEqual({ allow: true });
	});

	test("session_start writes payload and does not throw", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-hooks-start-"));
		try {
			const out = join(cwd, "started.json");
			const hooks = createHookRunner({
				cwd,
				hooks: [{ event: "session_start", command: `cat > ${JSON.stringify(out)}` }],
			});
			await hooks.sessionStart();
			const raw = await Bun.file(out).text();
			expect(JSON.parse(raw)).toEqual({ event: "session_start" });
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("post_tool receives success", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-hooks-post-"));
		try {
			const out = join(cwd, "post.json");
			const hooks = createHookRunner({
				cwd,
				hooks: [{ event: "post_tool", command: `cat > ${JSON.stringify(out)}` }],
			});
			await hooks.postTool("todo_write", { items: [] }, true);
			const raw = await Bun.file(out).text();
			expect(JSON.parse(raw)).toMatchObject({
				event: "post_tool",
				toolName: "todo_write",
				success: true,
			});
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
