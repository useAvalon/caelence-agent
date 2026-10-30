import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config.ts";
import type { AgentEvent, MainModelProvider } from "../core/events.ts";
import type { ConstructAgent } from "../core/strands.ts";
import { noopObservability } from "../observability/noop.ts";
import { createHarness } from "../runtime.ts";
import { startDesktopBridge } from "./bridge.ts";
import type { BridgeHost } from "./host.ts";

const provider: MainModelProvider = {
	kind: "fake",
	modelId: "fake",
	async *stream() {
		yield { type: "done" };
	},
};

async function withBridge(extensions?: BridgeHost) {
	const cwd = await mkdtemp(join(tmpdir(), "bridge-host-"));
	const prevHome = process.env.HARNESS_HOME;
	process.env.HARNESS_HOME = join(cwd, "home");
	const seen = { message: "", system: "", tools: [] as string[] };
	const constructAgent: ConstructAgent = (input) => {
		seen.system = input.systemPrompt;
		seen.tools = input.tools.map((t) => t.name);
		return {
			async run(message, emit) {
				seen.message = message;
				emit({ kind: "text_delta", text: "the answer" } satisfies AgentEvent);
			},
		};
	};
	const harness = await createHarness({
		cwd,
		config: { ...DEFAULT_CONFIG, name: "desk" },
		provider,
		constructAgent,
		observability: noopObservability,
	});
	const { ready, stop } = await startDesktopBridge({ cwd, harness, token: "t", extensions });
	const headers = { authorization: "Bearer t", "content-type": "application/json" };
	const get = (path: string) => fetch(`${ready.url}${path}`, { headers });
	const post = (path: string, body: unknown) =>
		fetch(`${ready.url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
	return {
		get,
		post,
		seen,
		harness,
		async close() {
			await stop();
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			await rm(cwd, { recursive: true, force: true });
		},
	};
}

async function sse(res: Response): Promise<AgentEvent[]> {
	const text = await res.text();
	return text
		.split("\n\n")
		.map((chunk) => chunk.trim())
		.filter((chunk) => chunk.startsWith("data: "))
		.map((chunk) => JSON.parse(chunk.slice(6)) as AgentEvent);
}

describe("bridge host extensions", () => {
	test("no extensions behaves like the plain bridge", async () => {
		const ctx = await withBridge();
		try {
			expect((await ctx.get("/state")).status).toBe(200);
			expect((await ctx.get("/nope")).status).toBe(404);
			const settings = (await (await ctx.get("/settings")).json()) as Record<string, unknown>;
			expect(settings).toHaveProperty("modelId");
		} finally {
			await ctx.close();
		}
	});

	test("host routes are served behind the token and can read the harness", async () => {
		const ctx = await withBridge({
			routes: {
				"GET /hello": async ({ harness }) => Response.json({ name: harness.config.name }),
			},
		});
		try {
			const res = await ctx.get("/hello");
			expect(await res.json()).toEqual({ name: "desk" });
			const unauth = await fetch(new URL("/hello", (await ctx.get("/state")).url));
			expect(unauth.status).toBe(401);
		} finally {
			await ctx.close();
		}
	});

	test("a host route replaces a built-in route with the same key", async () => {
		const ctx = await withBridge({
			routes: { "GET /health": async () => Response.json({ custom: true }) },
		});
		try {
			expect(await (await ctx.get("/health")).json()).toEqual({ custom: true });
		} finally {
			await ctx.close();
		}
	});

	test("settings fields are merged on read and write, and a host can reject input", async () => {
		let stored = "calm";
		const ctx = await withBridge({
			settings: () => ({ voice: stored }),
			applySettings: (_ctx, body) => {
				if (typeof body.voice !== "string") return undefined;
				if (body.voice === "bad") return "That voice is not available.";
				stored = body.voice;
				return undefined;
			},
		});
		try {
			expect(((await (await ctx.get("/settings")).json()) as { voice: string }).voice).toBe("calm");
			const ok = await ctx.post("/settings", { voice: "warm" });
			expect(((await ok.json()) as { voice: string }).voice).toBe("warm");
			const bad = await ctx.post("/settings", { voice: "bad" });
			expect(bad.status).toBe(400);
			expect(((await bad.json()) as { error: string }).error).toBe("That voice is not available.");
			expect(stored).toBe("warm");
		} finally {
			await ctx.close();
		}
	});

	test("model rows are listed first and not duplicated", async () => {
		const ctx = await withBridge({
			modelItems: () => [
				{ id: "acme/custom", label: "Custom" },
				{ id: "openrouter/auto", label: "dupe of a built-in" },
			],
		});
		try {
			const { items } = (await (await ctx.get("/models")).json()) as {
				items: Array<{ id: string }>;
			};
			expect(items[0]?.id).toBe("acme/custom");
			expect(items.filter((row) => row.id === "openrouter/auto")).toHaveLength(1);
		} finally {
			await ctx.close();
		}
	});

	test("beforeTurn changes what the model sees, and the chat keeps what the user typed", async () => {
		const ctx = await withBridge({
			displayText: (text) => text.replace(/^\[mode\]\n\n/, ""),
			beforeTurn: (_ctx, { message }) => ({
				message: `[mode]\n\n${message}`,
				options: { systemAppend: "Be brief.", excludeTools: ["exec"] },
			}),
		});
		try {
			const events = await sse(await ctx.post("/turn", { message: "open my notes" }));
			expect(events.at(-1)?.kind).toBe("completion");
			expect(ctx.seen.message).toBe("[mode]\n\nopen my notes");
			expect(ctx.seen.system).toContain("Be brief.");
			expect(ctx.seen.tools).not.toContain("exec");
			const sessionId = events.find((e) => e.kind === "session_meta") as { title: string };
			expect(sessionId.title).toBe("open my notes");
			const transcript = (await (await ctx.get("/state")).json()) as { title: string };
			expect(transcript.title).toBe("open my notes");
			const stored = JSON.stringify(await ctx.harness.store.get(ctx.harness.activeSessionId ?? ""));
			expect(stored).not.toContain("[mode]");
		} finally {
			await ctx.close();
		}
	});

	test("beforeTurn can answer without the model, and nothing is saved", async () => {
		const ctx = await withBridge({
			beforeTurn: () => ({ reply: "I didn't catch that." }),
		});
		try {
			const events = await sse(await ctx.post("/turn", { message: "..." }));
			expect(events.map((e) => e.kind)).toEqual(["text_delta", "completion"]);
			expect(ctx.seen.message).toBe("");
			expect(await ctx.harness.store.list()).toHaveLength(0);
		} finally {
			await ctx.close();
		}
	});

	test("a throwing beforeTurn is a 500, not a hung turn", async () => {
		const ctx = await withBridge({
			beforeTurn: () => {
				throw new Error("planner failed");
			},
		});
		try {
			const res = await ctx.post("/turn", { message: "hi" });
			expect(res.status).toBe(500);
			expect(((await res.json()) as { error: string }).error).toBe("planner failed");
			// The bridge must still accept the next turn.
			const next = await ctx.post("/turn", { message: "again" });
			expect(next.status).toBe(500);
		} finally {
			await ctx.close();
		}
	});

	test("slash commands bypass beforeTurn", async () => {
		let called = 0;
		const ctx = await withBridge({
			beforeTurn: () => {
				called += 1;
				return undefined;
			},
		});
		try {
			await ctx.post("/turn", { message: "/help" });
			expect(called).toBe(0);
		} finally {
			await ctx.close();
		}
	});
});
