import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localOpenCommand, resolveLocalPath } from "./open-local.ts";

describe("resolveLocalPath", () => {
	test("expands a home path and requires the file to exist", async () => {
		const dir = join(tmpdir(), `harness-open-${Date.now()}`);
		const file = join(dir, "note.txt");
		await mkdir(dir, { recursive: true });
		try {
			await writeFile(file, "x");
			expect(resolveLocalPath(file)).toBe(file);
			expect(resolveLocalPath(join(dir, "missing.txt"))).toBeUndefined();
			expect(resolveLocalPath("note.txt", dir)).toBe(file);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("rejects empty or injected paths", () => {
		expect(resolveLocalPath("")).toBeUndefined();
		expect(resolveLocalPath("a\nb")).toBeUndefined();
	});
});

describe("localOpenCommand", () => {
	test("reveals on macOS with open -R", () => {
		if (process.platform !== "darwin") return;
		expect(localOpenCommand("/tmp/note.txt", true)).toEqual({
			cmd: "/usr/bin/open",
			args: ["-R", "/tmp/note.txt"],
		});
		expect(localOpenCommand("/tmp/note.txt", false)).toEqual({
			cmd: "/usr/bin/open",
			args: ["/tmp/note.txt"],
		});
	});
});
