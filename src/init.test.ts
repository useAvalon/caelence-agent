import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initHost } from "./init.ts";
import { createLocalTools } from "./tools/local.ts";

describe("initHost", () => {
	test("default only gitignores .harness/", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-init-"));
		try {
			const first = initHost({ cwd, name: "demo" });
			expect(first.created).toEqual([".gitignore"]);
			expect(first.created).not.toContain("harness.config.ts");
			expect(first.created).not.toContain("AGENTS.md");
			const gitignore = await readFile(join(cwd, ".gitignore"), "utf8");
			expect(gitignore).toContain(".harness/");
			const second = initHost({ cwd, name: "demo" });
			expect(second.skipped).toContain(".gitignore");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("examples writes config, skill, eval, and gitignore", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-init-"));
		try {
			const first = initHost({ cwd, name: "demo", examples: true });
			expect(first.created).toContain("harness.config.ts");
			expect(first.created).toContain("AGENTS.md");
			const config = await readFile(join(cwd, "harness.config.ts"), "utf8");
			expect(config).toContain('name: "demo"');
			expect(config).toContain('model: "openrouter/auto"');
			expect(config).toContain('mode: "agent"');
			const second = initHost({ cwd, name: "demo", examples: true });
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

	test("can write an uploaded original outside cwd when allowlisted", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-tools-"));
		const outside = await mkdtemp(join(tmpdir(), "harness-orig-"));
		try {
			const original = join(outside, "brief.md");
			await Bun.write(original, "hello");
			const mcp = createLocalTools({ cwd, extraWriteAbsolutes: () => [original] });
			const written = await mcp.callTool("write_file", { path: original, content: "edited\n" });
			expect(written.isError).toBeFalsy();
			expect(await readFile(original, "utf8")).toBe("edited\n");
			const blocked = await mcp.callTool("write_file", {
				path: join(outside, "other.md"),
				content: "nope",
			});
			expect(blocked.isError).toBe(true);
		} finally {
			await rm(cwd, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});
});
