import { describe, expect, it } from "bun:test";
import {
	type ConstructAgent,
	constructOpenRouterProvider,
	createConstructAgent,
	type StrandsBackedProvider,
} from "../index.ts";

const BASE_URL = "https://openrouter.ai/api/v1";

describe("strands exports", () => {
	it("exposes the agent constructor and OpenRouter provider from the package entry", () => {
		expect(typeof createConstructAgent).toBe("function");
		expect(typeof constructOpenRouterProvider).toBe("function");
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

	it("reports no usage before any request has completed", () => {
		const provider = constructOpenRouterProvider({
			apiKey: "sk-test",
			model: "x-ai/grok",
			baseUrl: BASE_URL,
		});
		expect(provider.takeUsage?.()).toBeUndefined();
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
});
