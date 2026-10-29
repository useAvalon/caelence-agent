import { describe, expect, test } from "bun:test";
import { createExecApprovalGate } from "../core/approval.ts";
import { classifyToolApproval } from "./approval.ts";
import {
	clipState,
	DEFAULT_JEV_MODEL,
	decisionsUrl,
	type FetchImpl,
	readChoiceAnswer,
	readNoulAnswer,
	submitDecisions,
} from "./client.ts";
import { type ResolvedDecisions, resolveDecisions } from "./config.ts";
import { turnHasDurableFact } from "./memory.ts";

/** Shape copied from the OpenRouter Decisions API reference. */
const DOC_RESPONSE = {
	answers: {
		is_bug: { noul: 0.96, type: "noul" },
		team: {
			choice: "payments",
			confidence: 0.75,
			probabilities: { account: 0, frontend: 0.16, payments: 0.84 },
			type: "choice",
		},
	},
	model: "typesafe/jev-1.14-20260917",
	usage: { cost: 0.00002, input_tokens: 476, output_tokens: 70 },
};

function fakeFetch(body: unknown, init: { ok?: boolean } = {}) {
	const calls: Array<{ url: string; body: Record<string, unknown>; headers: HeadersInit }> = [];
	const impl: FetchImpl = async (url, req) => {
		calls.push({
			url: String(url),
			body: JSON.parse(String(req?.body)),
			headers: req?.headers ?? {},
		});
		return new Response(JSON.stringify(body), { status: init.ok === false ? 500 : 200 });
	};
	return { impl, calls };
}

function decisions(
	fetchImpl: FetchImpl,
	patch: Partial<ResolvedDecisions> = {},
): ResolvedDecisions {
	return {
		model: DEFAULT_JEV_MODEL,
		minConfidence: 0.6,
		approvalThreshold: 0.9,
		shortcuts: true,
		approvals: true,
		memory: true,
		apiKey: "sk-test",
		baseUrl: "https://openrouter.ai/api/v1",
		fetchImpl,
		...patch,
	};
}

describe("decisions client", () => {
	test("reads the documented answer shapes", () => {
		expect(readNoulAnswer(DOC_RESPONSE, "is_bug")).toBe(0.96);
		expect(readChoiceAnswer(DOC_RESPONSE, "team")).toEqual({
			choice: "payments",
			confidence: 0.75,
		});
		expect(readNoulAnswer(DOC_RESPONSE, "team")).toBeNull();
		expect(readChoiceAnswer(DOC_RESPONSE, "missing")).toBeNull();
		expect(readNoulAnswer(null, "is_bug")).toBeNull();
	});

	test("falls back to the top probability when confidence is absent", () => {
		const json = { answers: { x: { choice: "a", probabilities: { a: 0.7, b: 0.3 } } } };
		expect(readChoiceAnswer(json, "x")?.confidence).toBe(0.7);
	});

	test("posts model, state, and questions with a bearer key", async () => {
		const { impl, calls } = fakeFetch(DOC_RESPONSE);
		const out = await submitDecisions({
			apiKey: "sk-test",
			state: { a: 1 },
			questions: { q: { type: "noul" } },
			fetchImpl: impl,
		});
		expect(out).not.toBeNull();
		expect(calls[0]?.url).toBe("https://openrouter.ai/api/alpha/decisions");
		expect(calls[0]?.body.model).toBe(DEFAULT_JEV_MODEL);
		expect(calls[0]?.body.state).toEqual({ a: 1 });
		const headers = (calls[0]?.headers ?? {}) as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer sk-test");
	});

	test("returns null instead of throwing", async () => {
		const input = { apiKey: "sk-test", state: {}, questions: {} };
		expect(await submitDecisions({ ...input, apiKey: "  " })).toBeNull();
		expect(
			await submitDecisions({ ...input, fetchImpl: fakeFetch({}, { ok: false }).impl }),
		).toBeNull();
		expect(await submitDecisions({ ...input, fetchImpl: fakeFetch({ nope: 1 }).impl })).toBeNull();
		const boom: FetchImpl = async () => {
			throw new Error("network down");
		};
		expect(await submitDecisions({ ...input, fetchImpl: boom })).toBeNull();
	});

	test("gives up after the timeout", async () => {
		const never: FetchImpl = (_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
			});
		const started = Date.now();
		const out = await submitDecisions({
			apiKey: "sk-test",
			state: {},
			questions: {},
			timeoutMs: 50,
			fetchImpl: never,
		});
		expect(out).toBeNull();
		expect(Date.now() - started).toBeLessThan(2000);
	});

	test("builds the alpha URL beside /v1", () => {
		expect(decisionsUrl()).toBe("https://openrouter.ai/api/alpha/decisions");
		expect(decisionsUrl("https://proxy.example.com/api/v1/")).toBe(
			"https://proxy.example.com/api/alpha/decisions",
		);
		expect(decisionsUrl("https://proxy.example.com/v1")).toBe(
			"https://proxy.example.com/api/alpha/decisions",
		);
		expect(decisionsUrl("http://localhost:8787")).toBe("http://localhost:8787/api/alpha/decisions");
	});

	test("matches OpenRouter by hostname, never by substring", () => {
		// A proxy whose path mentions openrouter.ai must keep its own host.
		expect(decisionsUrl("https://proxy.example.com/openrouter.ai/v1")).toBe(
			"https://proxy.example.com/openrouter.ai/api/alpha/decisions",
		);
		expect(decisionsUrl("https://openrouter.ai.evil.example/v1")).toBe(
			"https://openrouter.ai.evil.example/api/alpha/decisions",
		);
		expect(decisionsUrl("https://notopenrouter.ai/v1")).toBe(
			"https://notopenrouter.ai/api/alpha/decisions",
		);
		expect(decisionsUrl("https://OpenRouter.AI/api/v1")).toBe(
			"https://openrouter.ai/api/alpha/decisions",
		);
		expect(decisionsUrl("https://eu.openrouter.ai/api/v1")).toBe(
			"https://openrouter.ai/api/alpha/decisions",
		);
		expect(decisionsUrl("not a url")).toBe("not a url/api/alpha/decisions");
	});

	test("clips long strings and deep or long structures", () => {
		const clipped = clipState({
			body: "x".repeat(5000),
			list: Array.from({ length: 50 }, (_, i) => i),
		});
		const row = clipped as { body: string; list: number[] };
		expect(row.body.length).toBeLessThan(700);
		expect(row.body).toContain("5000 chars");
		expect(row.list).toHaveLength(20);
	});
});

describe("resolveDecisions", () => {
	const env = {};
	test("is on by default when a key is set", () => {
		const out = resolveDecisions({}, "sk-test", "https://openrouter.ai/api/v1", env);
		expect(out?.model).toBe(DEFAULT_JEV_MODEL);
		expect(out?.shortcuts && out.approvals && out.memory).toBe(true);
		expect(out?.approvalThreshold).toBe(0.9);
	});

	test("is off without a key", () => {
		expect(resolveDecisions({}, "  ", "https://openrouter.ai/api/v1", env)).toBeUndefined();
	});

	test("is off by config or HARNESS_JEV", () => {
		const url = "https://openrouter.ai/api/v1";
		expect(resolveDecisions({ decisions: { enabled: false } }, "k", url, env)).toBeUndefined();
		for (const value of ["0", "false", "off"]) {
			expect(resolveDecisions({}, "k", url, { HARNESS_JEV: value })).toBeUndefined();
		}
	});

	test("falls back to the pinned model when model is not a usable string", () => {
		const url = "https://openrouter.ai/api/v1";
		for (const model of [42, null, {}, ["x"], "   ", ""]) {
			const config = { decisions: { model } } as unknown as Parameters<typeof resolveDecisions>[0];
			expect(resolveDecisions(config, "k", url, env)?.model).toBe(DEFAULT_JEV_MODEL);
		}
		const custom = { decisions: { model: "  typesafe/jev-1.13 " } };
		expect(resolveDecisions(custom, "k", url, env)?.model).toBe("typesafe/jev-1.13");
	});

	test("switches features off individually and ignores nonsense numbers", () => {
		const out = resolveDecisions(
			{ decisions: { approvals: false, memory: false, approvalThreshold: 7, minConfidence: -1 } },
			"k",
			"https://openrouter.ai/api/v1",
			env,
		);
		expect(out?.approvals).toBe(false);
		expect(out?.memory).toBe(false);
		expect(out?.shortcuts).toBe(true);
		expect(out?.approvalThreshold).toBe(0.9);
		expect(out?.minConfidence).toBe(0.6);
	});
});

describe("approval assist", () => {
	const exec = { callId: "1", toolName: "exec", input: { command: "bun test" } };
	const noul = (value: number) => fakeFetch({ answers: { safe_to_run: { noul: value } } });

	test("allows only at or above the threshold", async () => {
		expect(await classifyToolApproval(decisions(noul(0.95).impl), exec, "run the tests")).toBe(
			"allow",
		);
		expect(await classifyToolApproval(decisions(noul(0.9).impl), exec, "run the tests")).toBe(
			"allow",
		);
		expect(await classifyToolApproval(decisions(noul(0.89).impl), exec, "run the tests")).toBe(
			"ask",
		);
	});

	test("a low score asks and never denies", async () => {
		const verdict = await classifyToolApproval(decisions(noul(0.01).impl), exec, "run the tests");
		expect(verdict).toBe("ask");
	});

	test("destructive commands never reach the model", async () => {
		const { impl, calls } = noul(0.99);
		const verdict = await classifyToolApproval(
			decisions(impl),
			{ callId: "1", toolName: "exec", input: { command: "git push --force origin main" } },
			"push my work",
		);
		expect(verdict).toBe("ask");
		expect(calls).toHaveLength(0);
	});

	test("asks when there is no user message, the feature is off, or the call fails", async () => {
		const { impl, calls } = noul(0.99);
		expect(await classifyToolApproval(decisions(impl), exec, "  ")).toBe("ask");
		expect(await classifyToolApproval(decisions(impl, { approvals: false }), exec, "go")).toBe(
			"ask",
		);
		expect(calls).toHaveLength(0);
		expect(
			await classifyToolApproval(decisions(fakeFetch({}, { ok: false }).impl), exec, "go"),
		).toBe("ask");
	});

	test("sends the clipped tool input, not a whole file", async () => {
		const { impl, calls } = noul(0.99);
		await classifyToolApproval(
			decisions(impl),
			{ callId: "1", toolName: "write_file", input: { path: "a.ts", content: "x".repeat(50_000) } },
			"write a.ts",
		);
		expect(JSON.stringify(calls[0]?.body).length).toBeLessThan(3000);
	});
});

describe("approval gate with assist", () => {
	const exec = { callId: "1", toolName: "exec", input: { command: "bun test" } };

	test("allow skips the prompt", async () => {
		let asked = 0;
		const gate = createExecApprovalGate({
			policy: "prompt",
			ask: async () => {
				asked += 1;
				return false;
			},
			assist: async () => "allow",
		});
		expect(await gate.request(exec)).toBe(true);
		expect(asked).toBe(0);
	});

	test("ask and a throwing assist both fall through to the prompt", async () => {
		for (const assist of [async () => "ask" as const, async () => Promise.reject(new Error("x"))]) {
			let asked = 0;
			const gate = createExecApprovalGate({
				policy: "prompt",
				ask: async () => {
					asked += 1;
					return true;
				},
				assist,
			});
			expect(await gate.request(exec)).toBe(true);
			expect(asked).toBe(1);
		}
	});

	test("assist never overrides the deny policy or the auto policy's denylist", async () => {
		const allowAll = async () => "allow" as const;
		const deny = createExecApprovalGate({ policy: "deny", assist: allowAll });
		expect(await deny.request(exec)).toBe(false);
		const auto = createExecApprovalGate({ policy: "auto", assist: allowAll });
		expect(
			await auto.request({ callId: "2", toolName: "exec", input: { command: "sudo reboot" } }),
		).toBe(false);
	});

	test("upload edits always show the user what they replace", async () => {
		let assisted = 0;
		let asked = 0;
		const gate = createExecApprovalGate({
			policy: "prompt",
			ask: async () => {
				asked += 1;
				return true;
			},
			resolveUploadEdit: () => ({ rel: "copy.txt", sourcePath: "/orig.txt", name: "orig.txt" }),
			assist: async () => {
				assisted += 1;
				return "allow";
			},
		});
		await gate.request({ callId: "3", toolName: "write_file", input: { path: "copy.txt" } });
		expect(assisted).toBe(0);
		expect(asked).toBe(1);
	});

	test("a user who disabled prompts is not asked at all", async () => {
		let assisted = 0;
		const gate = createExecApprovalGate({
			policy: "prompt",
			assist: async () => {
				assisted += 1;
				return "allow";
			},
		});
		expect(await gate.request({ callId: "4", toolName: "write_file", input: { path: "a" } })).toBe(
			true,
		);
		expect(assisted).toBe(0);
	});
});

describe("memory gate", () => {
	const durable = (value: number) => fakeFetch({ answers: { durable: { noul: value } } });

	test("skips extraction only when Jev is confident there is nothing to keep", async () => {
		expect(await turnHasDurableFact(decisions(durable(0.02).impl), "User: fix the bug")).toBe(
			false,
		);
		expect(await turnHasDurableFact(decisions(durable(0.1).impl), "User: fix the bug")).toBe(true);
		expect(await turnHasDurableFact(decisions(durable(0.9).impl), "User: I prefer bun")).toBe(true);
	});

	test("extracts when the call fails or the gate is off", async () => {
		expect(await turnHasDurableFact(decisions(fakeFetch({}, { ok: false }).impl), "x")).toBe(true);
		const { impl, calls } = durable(0);
		expect(await turnHasDurableFact(decisions(impl, { memory: false }), "x")).toBe(true);
		expect(calls).toHaveLength(0);
	});
});
