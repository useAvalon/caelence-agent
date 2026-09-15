import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "./main.ts";

describe("parseCliArgs", () => {
	test("strips --cwd before the command", () => {
		const parsed = parseCliArgs(["--cwd", "/tmp/proj", "eval"]);
		expect(parsed.cmd).toBe("eval");
		expect(parsed.cwd).toContain("proj");
		expect(parsed.rest).toEqual([]);
	});

	test("strips --cwd after the command", () => {
		const parsed = parseCliArgs(["eval", "--cwd", "/tmp/proj"]);
		expect(parsed.cmd).toBe("eval");
		expect(parsed.cwd).toContain("proj");
	});

	test("reads chat -m", () => {
		const parsed = parseCliArgs(["chat", "-m", "hello"]);
		expect(parsed.cmd).toBe("chat");
		expect(parsed.message).toBe("hello");
	});

	test("reads desktop", () => {
		const parsed = parseCliArgs(["desktop", "--cwd", "/tmp/proj"]);
		expect(parsed.cmd).toBe("desktop");
		expect(parsed.cwd).toContain("proj");
	});

	test("reads --mode", () => {
		const parsed = parseCliArgs(["--mode", "ask", "chat", "-m", "hello"]);
		expect(parsed.cmd).toBe("chat");
		expect(parsed.mode).toBe("ask");
		expect(parsed.message).toBe("hello");
	});
});
