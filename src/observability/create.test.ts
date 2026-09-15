import { describe, expect, test } from "bun:test";
import { createObservability, resetObservabilityForTests } from "./create.ts";
import { createRecordingObservability } from "./fake.ts";
import { noopObservability } from "./noop.ts";
import { langfuseKeysPresent, resolveAgentVersion } from "./version.ts";

describe("createObservability", () => {
	test("no-ops when keys are unset", async () => {
		resetObservabilityForTests();
		const obs = await createObservability({ env: {} });
		expect(obs.enabled).toBe(false);
		expect(obs).toBe(noopObservability);
		let ran = false;
		await obs.startTurn({ name: "agent_turn" }, async () => {
			ran = true;
		});
		expect(ran).toBe(true);
	});

	test("keysPresent requires both public and secret", () => {
		expect(langfuseKeysPresent({})).toBe(false);
		expect(langfuseKeysPresent({ LANGFUSE_PUBLIC_KEY: "pk" })).toBe(false);
		expect(langfuseKeysPresent({ LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" })).toBe(
			true,
		);
	});
});

describe("resolveAgentVersion", () => {
	test("env wins over fallback", () => {
		expect(resolveAgentVersion("pkg", { CAELENCE_AGENT_VERSION: "website-agent-v42" })).toBe(
			"website-agent-v42",
		);
		expect(resolveAgentVersion("0.1.0", {})).toBe("0.1.0");
	});
});

describe("recording observer", () => {
	test("nests tools under a turn", async () => {
		const obs = createRecordingObservability();
		await obs.startTurn({ name: "agent_turn", sessionId: "sess_1" }, async (root) => {
			root.update({ input: "hi" });
			await obs.tool("write_file", async (span) => {
				span.update({ input: { path: "a.ts" }, output: "ok" });
			});
			await obs.generation("llm", async (gen) => {
				gen.update({ model: "fake", output: "done" });
			});
			obs.score({ name: "build_success", value: 1 });
		});
		expect(obs.turns).toHaveLength(1);
		expect(obs.turns[0]?.children.map((c) => c.kind)).toEqual(["tool", "generation"]);
		expect(obs.scores[0]?.name).toBe("build_success");
		expect(obs.currentTraceId()).toBeUndefined();
	});
});
