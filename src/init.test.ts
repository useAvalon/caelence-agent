import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initHost } from "./init.ts";
import { createLocalTools } from "./tools/local.ts";

describe("initHost", () => {
	test("writes config, skill, eval, and gitignore", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-init-"));
		try {
			const first = initHost({ cwd, name: "demo" });
			expect(first.created).toContain("harness.config.ts");
			expect(first.created).toContain("AGENTS.md");
			const config = await readFile(join(cwd, "harness.config.ts"), "utf8");
			expect(config).toContain('name: "demo"');
			expect(config).toContain('mode: "agent"');
			const second = initHost({ cwd, name: "demo" });
			expect(second.skipped).toContain("harness.config.ts");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});

describe("local tools", () => {
	test("write, read, edit, glob, grep stay under cwd", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-tools-"));
		try {
			const mcp = createLocalTools({ cwd });
			const written = await mcp.callTool("write_file", {
				path: "src/a.ts",
				content: " cons t x = 1;\n",
			});
			expect(written.isError).toBeFalsy();
			const edited = await mcp.callTool("edit_file", {
				path: "src/a.ts",
				old_str: " cons t x = 1;\n",
				new_str: "const x = 1;\n",
			});
			expect(edited.isError).toBeFalsy();
			const read = await mcp.callTool("read_file", { path: "src/a.ts" });
			expect(read.content[0]?.text).toBe("const x = 1;\n");
			const glob = await mcp.callTool("glob", { pattern: "**/*.ts" });
			expect(JSON.stringify(glob.structuredContent)).toContain("src/a.ts");
			const grep = await mcp.callTool("grep", { pattern: "const x" });
			expect(JSON.stringify(grep.structuredContent)).toContain("src/a.ts");
			const denied = await mcp.callTool("read_file", { path: "../secret" });
			expect(denied.isError).toBe(true);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
