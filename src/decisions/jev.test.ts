import { describe, expect, test } from "bun:test";
import { classifyBerryRoute, submitJevDecisions } from "./jev.ts";

describe("classifyBerryRoute", () => {
	test("parses a high-confidence open_search choice", async () => {
		const fetchImpl = async () =>
			new Response(
				JSON.stringify({
					answers: {
						route: {
							type: "choice",
							choice: "open_search",
							confidence: 0.9,
						},
					},
				}),
				{ status: 200 },
			);
		const plan = await classifyBerryRoute({
			message: "look up react 19 release notes",
			apiKey: "sk-test",
			fetchImpl,
		});
		expect(plan?.route).toBe("open_search");
	});

	test("returns null on low confidence", async () => {
		const fetchImpl = async () =>
			new Response(
				JSON.stringify({
					answers: {
						route: { type: "choice", choice: "open_url", confidence: 0.2 },
					},
				}),
				{ status: 200 },
			);
		const plan = await classifyBerryRoute({
			message: "maybe open something",
			apiKey: "sk-test",
			fetchImpl,
		});
		expect(plan).toBeNull();
	});

	test("Go to Notion sends the router X-Title", async () => {
		let title = "";
		await submitJevDecisions({
			apiKey: "sk-test",
			state: { user_message: "Go to Notion" },
			questions: { route: { type: "choice", instructions: "x", criteria: { agent: "a" } } },
			fetchImpl: async (_url, init) => {
				title = new Headers(init?.headers).get("X-Title") ?? "";
				return new Response("{}", { status: 200 });
			},
		});
		expect(title).toBe("agent:router");
	});
});
