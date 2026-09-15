import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { PathEscapeError, resolveUnderCwd } from "./paths.ts";

describe("resolveUnderCwd", () => {
	const cwd = resolve("/tmp/project");

	test("resolves a relative file", () => {
		expect(resolveUnderCwd(cwd, "src/index.ts")).toBe(resolve(cwd, "src/index.ts"));
	});

	test("rejects absolute paths", () => {
		expect(() => resolveUnderCwd(cwd, "/etc/passwd")).toThrow(PathEscapeError);
	});

	test("rejects parent traversal", () => {
		expect(() => resolveUnderCwd(cwd, "../secret")).toThrow(PathEscapeError);
		expect(() => resolveUnderCwd(cwd, "foo/../../etc/passwd")).toThrow(PathEscapeError);
	});

	test("allows dot segments that stay inside", () => {
		expect(resolveUnderCwd(cwd, "src/./lib.ts")).toBe(resolve(cwd, "src/lib.ts"));
	});
});
