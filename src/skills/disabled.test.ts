import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	disableSkills,
	enableSkills,
	isSkillDisabled,
	readDisabledSkillNames,
} from "./disabled.ts";

describe("disabled skills", () => {
	test("disabling copywriting also hides the pipeline steps", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "harness-disabled-"));
		try {
			expect(disableSkills(cwd, "copywriting")).toContain("copy-editor");
			expect(isSkillDisabled(cwd, "copywriting")).toBe(true);
			expect(isSkillDisabled(cwd, "copy-rmbc")).toBe(true);
			expect(readDisabledSkillNames(cwd).has("impeccable")).toBe(false);
			enableSkills(cwd, "copywriting");
			expect(isSkillDisabled(cwd, "copywriting")).toBe(false);
			expect(isSkillDisabled(cwd, "copy-editor")).toBe(false);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
