import { describe, expect, it } from "bun:test";
import {
	type AgentConstructionInput,
	type ConstructAgent,
	constructOpenRouterProvider,
	createConstructAgent,
	Offload,
	type StrandsBackedProvider,
} from "../index.ts";

const BASE_URL = "https://openrouter.ai/api/v1";

describe("strands exports", () => {
	it("exposes the agent constructor and OpenRouter provider from the package entry", () => {
		expect(typeof createConstructAgent).toBe("function");
		expect(typeof constructOpenRouterProvider).toBe("function");
		expect(typeof Offload.drop).toBe("function");
	});
});

describe("constructOpenRouterProvider", () => {
	it("returns a provider that reports a missing key instead of calling the network", async () => {
		const provider = constructOpenRouterProvider({
			apiKey: "  ",
			model: "x-ai/grok",
			baseUrl: BASE_URL,
		});
		expect(provider.modelId).toBe("x-ai/grok");
		const events = [];
		for await (const event of provider.stream({ messages: [{ role: "user", content: "hi" }] })) {
			events.push(event);
		}
		expect(events).toEqual([
			{ type: "error", message: "OPENROUTER_API_KEY is not set." },
			{ type: "done" },
		]);
	});

	it("builds a Strands-backed provider for a real key", () => {
		const provider = constructOpenRouterProvider({
			apiKey: "sk-test",
			model: "x-ai/grok",
			baseUrl: `${BASE_URL}/`,
		}) as StrandsBackedProvider;
		expect(provider.kind).toBe("openrouter");
		expect(provider.sdkModel).toBeDefined();
		expect(typeof provider.takeUsage).toBe("function");
		expect(typeof provider.setReasoningSink).toBe("function");
	});

	it("sends the chosen reasoning effort on chat requests", async () => {
		const bodies: unknown[] = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
			return new Response(JSON.stringify({ error: { message: "stop" } }), { status: 400 });
		}) as unknown as typeof fetch;
		try {
			const provider = constructOpenRouterProvider({
				apiKey: "sk-test",
				model: "x-ai/grok",
				baseUrl: BASE_URL,
				reasoningEffort: "high",
			});
			for await (const _event of provider.stream({
				messages: [{ role: "user", content: "hi" }],
			})) {
				// drain
			}
		} finally {
			globalThis.fetch = realFetch;
		}
		expect(bodies.length).toBeGreaterThan(0);
		const body = bodies[0] as { reasoning?: { effort?: string; exclude?: boolean } };
		expect(body.reasoning).toEqual({ effort: "high", exclude: false });
	});

	it("reports no usage before any request has completed", async () => {
		const provider = constructOpenRouterProvider({
			apiKey: "sk-test",
			model: "x-ai/grok",
			baseUrl: BASE_URL,
		});
		expect(await provider.takeUsage?.()).toBeUndefined();
	});

	it("adds billed cost from every model call in the turn", async () => {
		const remaining = [
			{ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.01 },
			{ prompt_tokens: 20, completion_tokens: 3, total_tokens: 23, cost: 0.02 },
		];
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			const usage = remaining.shift() ?? {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
				cost: 0,
			};
			const body = [
				`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`,
				`data: ${JSON.stringify({
					choices: [{ delta: {}, finish_reason: "stop" }],
					usage,
				})}\n\n`,
				"data: [DONE]\n\n",
			].join("");
			return new Response(body, { headers: { "content-type": "text/event-stream" } });
		}) as unknown as typeof fetch;
		try {
			const provider = constructOpenRouterProvider({
				apiKey: "sk-test",
				model: "anthropic/claude-opus-4.5",
				baseUrl: BASE_URL,
			});
			for (let i = 0; i < 2; i++) {
				for await (const _event of provider.stream({
					messages: [{ role: "user", content: "hi" }],
				})) {
					// drain
				}
			}
			const usage = await provider.takeUsage?.();
			expect(usage).toEqual({
				promptTokens: 30,
				completionTokens: 5,
				totalTokens: 35,
				costUsd: 0.03,
			});
			expect(await provider.takeUsage?.()).toBeUndefined();
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});

describe("createConstructAgent", () => {
	it("refuses a provider that is not backed by the Strands SDK", () => {
		const construct: ConstructAgent = createConstructAgent();
		const plain = constructOpenRouterProvider({ apiKey: "", model: "m", baseUrl: BASE_URL });
		expect(() =>
			construct({ systemPrompt: "s", tools: [], provider: plain, messages: [] }),
		).toThrow("Strands-backed");
	});

	it("constructs an agent for a Strands-backed provider without running it", () => {
		const construct = createConstructAgent();
		const provider = constructOpenRouterProvider({
			apiKey: "sk-test",
			model: "m",
			baseUrl: BASE_URL,
		});
		const agent = construct({
			systemPrompt: "You are a test.",
			tools: [
				{
					name: "echo",
					description: "Echo input.",
					inputSchema: { type: "object", properties: {} },
					invoke: async () => ({ content: [{ type: "text", text: "ok" }] }),
				},
			],
			provider,
			messages: [{ role: "user", content: "earlier" }],
		});
		expect(typeof agent.run).toBe("function");
	});

	it("asks the host for a context manager when constructing an agent", () => {
		const seen: AgentConstructionInput[] = [];
		const construct = createConstructAgent({
			contextManager: (input) => {
				seen.push(input);
				return {
					strategies: [Offload.drop("toolResults").when({ preserveRecent: 6 })],
				};
			},
		});
		const provider = constructOpenRouterProvider({
			apiKey: "sk-test",
			model: "m",
			baseUrl: BASE_URL,
		});
		construct({
			systemPrompt: "You are a test.",
			tools: [],
			provider,
			messages: [],
		});
		expect(seen).toHaveLength(1);
		expect(seen[0]?.systemPrompt).toBe("You are a test.");
	});
});
