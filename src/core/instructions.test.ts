import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadInstructionLayers, userInstructionsPath } from "./instructions.ts";

describe("instruction layers", () => {
	test("user path honors HARNESS_USER_INSTRUCTIONS", () => {
		expect(userInstructionsPath({ HARNESS_USER_INSTRUCTIONS: "/tmp/user-agents.md" })).toBe(
			"/tmp/user-agents.md",
		);
	});

	test("stacks user then project without replacing either", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-instr-"));
		const userDir = await mkdtemp(join(tmpdir(), "harness-user-"));
		try {
			await writeFile(join(cwd, "AGENTS.md"), "project rule\n", "utf8");
			const userFile = join(userDir, "AGENTS.md");
			await writeFile(userFile, "user rule\n", "utf8");
			const layers = loadInstructionLayers({
				cwd,
				projectFile: "AGENTS.md",
				env: { HARNESS_USER_INSTRUCTIONS: userFile },
			});
			expect(layers.user).toBe("user rule");
			expect(layers.project).toBe("project rule");
		} finally {
			await rm(cwd, { recursive: true, force: true });
			await rm(userDir, { recursive: true, force: true });
		}
	});

	test("missing files are empty strings", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-instr-empty-"));
		try {
			await mkdir(join(cwd, "empty"), { recursive: true });
			const layers = loadInstructionLayers({
				cwd,
				projectFile: "missing.md",
				env: { HARNESS_USER_INSTRUCTIONS: join(cwd, "nope.md") },
			});
			expect(layers.user).toBe("");
			expect(layers.project).toBe("");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
