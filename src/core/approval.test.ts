import { describe, expect, test } from "bun:test";
import {
	createExecApprovalGate,
	isLikelyDestructive,
	parseExecApprovalPolicy,
} from "../core/approval.ts";

describe("exec approval", () => {
	test("flags destructive commands", () => {
		expect(isLikelyDestructive("sudo rm -rf /")).toBe(true);
		expect(isLikelyDestructive("npm publish")).toBe(true);
		expect(isLikelyDestructive("git push --force origin main")).toBe(true);
		expect(isLikelyDestructive("bun test")).toBe(false);
		expect(isLikelyDestructive("git status")).toBe(false);
	});

	test("parses policy", () => {
		expect(parseExecApprovalPolicy("auto")).toBe("auto");
		expect(parseExecApprovalPolicy("nope")).toBe("prompt");
	});

	test("deny policy rejects exec and git_commit", async () => {
		const gate = createExecApprovalGate({ policy: "deny" });
		expect(await gate.request({ callId: "1", toolName: "exec", input: { command: "ls" } })).toBe(
			false,
		);
		expect(
			await gate.request({ callId: "2", toolName: "git_commit", input: { message: "x" } }),
		).toBe(false);
		expect(await gate.request({ callId: "1", toolName: "read_file", input: { path: "a" } })).toBe(
			true,
		);
		expect(await gate.request({ callId: "3", toolName: "git_status", input: {} })).toBe(true);
	});

	test("alwaysAllow admits git_commit after a session grant", async () => {
		const alwaysAllow = new Set<string>();
		const gate = createExecApprovalGate({ policy: "deny", alwaysAllow });
		expect(
			await gate.request({ callId: "1", toolName: "git_commit", input: { message: "x" } }),
		).toBe(false);
		alwaysAllow.add("git_commit");
		expect(
			await gate.request({ callId: "2", toolName: "git_commit", input: { message: "x" } }),
		).toBe(true);
		expect(await gate.request({ callId: "3", toolName: "exec", input: { command: "ls" } })).toBe(
			false,
		);
	});

	test("auto policy allows ordinary commands", async () => {
		const gate = createExecApprovalGate({ policy: "auto" });
		expect(
			await gate.request({ callId: "1", toolName: "exec", input: { command: "bun test" } }),
		).toBe(true);
		expect(
			await gate.request({ callId: "1", toolName: "exec", input: { command: "sudo ls" } }),
		).toBe(false);
	});

	test("prompt policy asks before ordinary file writes", async () => {
		const asked: string[] = [];
		const alwaysAllow = new Set<string>();
		const gate = createExecApprovalGate({
			policy: "prompt",
			alwaysAllow,
			ask: async (req) => {
				asked.push(`${req.toolName}:${String(req.input.path)}`);
				return true;
			},
		});
		expect(
			await gate.request({
				callId: "1",
				toolName: "write_file",
				input: { path: "README.md", content: "x" },
			}),
		).toBe(true);
		expect(asked).toEqual(["write_file:README.md"]);
		alwaysAllow.add("write_file");
		alwaysAllow.add("edit_file");
		expect(
			await gate.request({
				callId: "2",
				toolName: "edit_file",
				input: { path: "README.md", old: "x", new: "y" },
			}),
		).toBe(true);
		expect(asked).toEqual(["write_file:README.md"]);
	});

	test("deny and auto still allow file writes", async () => {
		const deny = createExecApprovalGate({ policy: "deny" });
		const auto = createExecApprovalGate({ policy: "auto" });
		expect(
			await deny.request({ callId: "1", toolName: "write_file", input: { path: "a.ts" } }),
		).toBe(true);
		expect(
			await auto.request({ callId: "2", toolName: "edit_file", input: { path: "a.ts" } }),
		).toBe(true);
	});
});
