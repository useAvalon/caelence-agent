import { describe, expect, test } from "bun:test";
import {
	createExecApprovalGate,
	isLikelyDestructive,
	isUploadEditRequest,
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

	test("asks where to edit an uploaded file with an original path", async () => {
		const input: Record<string, unknown> = { path: ".harness/uploads/1-note.txt" };
		const asked: string[] = [];
		const gate = createExecApprovalGate({
			policy: "prompt",
			resolveUploadEdit: (path) =>
				path.includes("uploads")
					? { rel: path, sourcePath: "/tmp/note.txt", name: "note.txt" }
					: undefined,
			ask: async (req) => {
				asked.push(req.toolName);
				expect(isUploadEditRequest(req)).toBe(true);
				req.input.path = req.input.originalPath;
				return true;
			},
		});
		expect(await gate.request({ callId: "1", toolName: "edit_file", input })).toBe(true);
		expect(asked).toEqual(["edit_file"]);
		expect(input.path).toBe("/tmp/note.txt");
	});
});

describe("promptOnly", () => {
	const deletes = (req: { input: Record<string, unknown> }) =>
		/\brm\b/.test(String(req.input.command ?? ""));

	test("requests it rejects run without asking", async () => {
		let asked = 0;
		const gate = createExecApprovalGate({
			policy: "prompt",
			ask: async () => {
				asked += 1;
				return false;
			},
			promptOnly: deletes,
		});
		expect(
			await gate.request({ callId: "1", toolName: "exec", input: { command: "bun test" } }),
		).toBe(true);
		expect(await gate.request({ callId: "2", toolName: "write_file", input: { path: "a" } })).toBe(
			true,
		);
		expect(asked).toBe(0);
	});

	test("requests it accepts still ask", async () => {
		let asked = 0;
		const gate = createExecApprovalGate({
			policy: "prompt",
			ask: async () => {
				asked += 1;
				return false;
			},
			promptOnly: deletes,
		});
		expect(
			await gate.request({ callId: "3", toolName: "exec", input: { command: "rm -rf dist" } }),
		).toBe(false);
		expect(asked).toBe(1);
	});

	test("the deny policy still refuses what it lets through", async () => {
		const gate = createExecApprovalGate({ policy: "deny", promptOnly: deletes });
		expect(await gate.request({ callId: "4", toolName: "exec", input: { command: "rm x" } })).toBe(
			false,
		);
	});
});

describe("confirm requests (a tool asked for a human on this call)", () => {
	const confirmReq = {
		callId: "c1",
		toolName: "browser_click",
		input: { element: "Post button" },
		reason: "Click the Post button",
	};

	test("always ask, even under promptOnly, always-allow, and the auto policy", async () => {
		for (const policy of ["prompt", "auto"] as const) {
			let asked = 0;
			let assisted = 0;
			const gate = createExecApprovalGate({
				policy,
				alwaysAllow: new Set(["browser_click"]),
				promptOnly: () => false,
				assist: async () => {
					assisted += 1;
					return "allow";
				},
				ask: async () => {
					asked += 1;
					return false;
				},
			});
			expect(await gate.request(confirmReq)).toBe(false);
			expect(asked).toBe(1);
			expect(assisted).toBe(0);
		}
	});

	test("the deny policy refuses without asking", async () => {
		let asked = 0;
		const gate = createExecApprovalGate({
			policy: "deny",
			ask: async () => {
				asked += 1;
				return true;
			},
		});
		expect(await gate.request(confirmReq)).toBe(false);
		expect(asked).toBe(0);
	});

	test("with nobody to ask, the answer is no", async () => {
		const gate = createExecApprovalGate({ policy: "prompt" });
		expect(await gate.request(confirmReq)).toBe(false);
	});

	test("the reason reaches the approval card", async () => {
		const events: unknown[] = [];
		const gate = createExecApprovalGate({
			policy: "prompt",
			emit: (event) => events.push(event),
			ask: async () => true,
		});
		expect(await gate.request(confirmReq)).toBe(true);
		expect(events[0]).toMatchObject({
			kind: "approval_request",
			toolName: "browser_click",
			reason: "Click the Post button",
		});
	});

	test("a yes covers one call only", async () => {
		let asked = 0;
		const gate = createExecApprovalGate({
			policy: "prompt",
			ask: async () => {
				asked += 1;
				return true;
			},
		});
		await gate.request(confirmReq);
		await gate.request({ ...confirmReq, callId: "c2" });
		expect(asked).toBe(2);
	});
});
