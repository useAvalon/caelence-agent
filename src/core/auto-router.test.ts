import { describe, expect, test } from "bun:test";
import { autoRouterPluginId, injectAutoRouterPayload } from "./auto-router.ts";

describe("auto router payload", () => {
	test("leaves a fixed model untouched", () => {
		const body = { model: "~x-ai/grok-latest", messages: [] };
		expect(injectAutoRouterPayload(body, { model: body.model })).toEqual(body);
		expect(autoRouterPluginId(body.model)).toBeUndefined();
	});

	test("adds the auto plugin, cost band, and session id", () => {
		const next = injectAutoRouterPayload(
			{ model: "openrouter/auto", messages: [] },
			{ model: "openrouter/auto", sessionId: "ses_1" },
		);
		expect(next).toEqual({
			model: "openrouter/auto",
			messages: [],
			session_id: "ses_1",
			plugins: [{ id: "auto-router", cost_tier: "high" }],
		});
	});

	test("uses auto-beta-router for the beta slug", () => {
		const next = injectAutoRouterPayload(
			{ model: "openrouter/auto-beta", messages: [] },
			{ model: "openrouter/auto-beta" },
		) as { plugins: Array<{ id: string }> };
		expect(next.plugins[0]?.id).toBe("auto-beta-router");
	});
});
