import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "../core/session.ts";
import type { HarnessRuntime } from "../runtime.ts";
import { clearPopularSkillsCache, writePopularSkillsCache } from "../skills/catalog.ts";
import { HARNESS_MODELS } from "./models.ts";
import { applyPickerChoice, dispatchSlash, runSlashLine } from "./slash-dispatch.ts";

function fakeHarness(overrides: Partial<HarnessRuntime> = {}): HarnessRuntime {
	const sessions: Session[] = [
		{
			id: "s1",
			title: "Billing copy",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			model: "openai/gpt-5.6-sol",
			messages: [],
		},
	];
	return {
		cwd: "/tmp/proj",
		config: { evalsDir: "evals" } as HarnessRuntime["config"],
		theme: {} as HarnessRuntime["theme"],
		skills: [{ name: "copywriting", source: "host" }] as HarnessRuntime["skills"],
		store: {
			async list() {
				return sessions;
			},
			async get(id: string) {
				return sessions.find((session) => session.id === id);
			},
		} as HarnessRuntime["store"],
		systemPrompt: "",
		modelId: "openai/gpt-5.6-sol",
		mode: "agent",
		runTurn: async () => undefined,
		setModel(id) {
			this.modelId = id;
		},
		setMode(mode) {
			this.mode = mode;
		},
		hasApiKey: false,
		setApiKey() {},
		setSession() {},
		allowExecAlways() {},
		allowRiskyAlways() {},
		compact: async () => false,
		reloadSkills() {
			return this.skills;
		},
		authorSkill: async () => ({ rel: "skills/demo/SKILL.md" }),
		findSkills: async () => "frontend-design",
		addSkill: async () => ({ rel: "frontend-design/SKILL.md" }),
		removeSkill: () => ({ ok: true }),
		disabledSkills: () => [],
		enableSkill: () => ({ ok: true }),
		reloadIntegrations: async () => {},
		reloadExtraMcp: async () => {},
		chat: async () => "",
		observability: {} as HarnessRuntime["observability"],
		close() {},
		...overrides,
	} as HarnessRuntime;
}

describe("dispatchSlash", () => {
	test("help lists slash commands", async () => {
		const result = await dispatchSlash(fakeHarness(), "/help");
		expect(result.kind).toBe("text");
		if (result.kind === "text") expect(result.text).toContain("/resume");
	});

	test("resume without an argument opens a title picker", async () => {
		const result = await dispatchSlash(fakeHarness(), "/resume");
		expect(result).toMatchObject({
			kind: "picker",
			picker: "resume",
		});
		if (result.kind === "picker") {
			expect(result.items[0]?.label).toBe("Billing copy");
			expect(result.items[0]?.id).toBe("s1");
		}
	});

	test("resume matches a title", async () => {
		const result = await dispatchSlash(fakeHarness(), "/resume billing");
		expect(result.kind).toBe("session");
		if (result.kind === "session") expect(result.session.title).toBe("Billing copy");
	});

	test("model without an argument opens a label picker", async () => {
		const result = await dispatchSlash(fakeHarness(), "/model");
		expect(result.kind).toBe("picker");
		if (result.kind === "picker") {
			expect(result.items.some((item) => item.label === "Auto")).toBe(true);
			expect(result.items.some((item) => item.id === "openrouter/auto")).toBe(true);
			expect(result.items.some((item) => item.label === "Grok latest")).toBe(true);
			expect(result.items.some((item) => item.id === "~x-ai/grok-latest")).toBe(true);
		}
	});

	test("transcribe without an argument lists Muse, MAI, Voxtral, Qwen, and NVIDIA", async () => {
		const result = await dispatchSlash(fakeHarness(), "/transcribe");
		expect(result.kind).toBe("picker");
		if (result.kind === "picker") {
			const ids = result.items.map((item) => item.id);
			expect(ids).toContain("meta/muse-voice-transcribe-1.0");
			expect(ids).toContain("microsoft/mai-transcribe-2");
			expect(ids).toContain("mistralai/voxtral-mini-transcribe");
			expect(ids).toContain("qwen/qwen3-asr-1.7b");
			expect(ids).toContain("nvidia/parakeet-tdt-0.6b-v3");
		}
	});

	test("image without a prompt opens a model picker", async () => {
		const result = await dispatchSlash(fakeHarness(), "/image");
		expect(result.kind).toBe("picker");
		if (result.kind === "picker") {
			expect(result.picker).toBe("image");
			expect(result.items.some((item) => item.id === "black-forest-labs/flux.2-pro")).toBe(true);
		}
	});

	test("image with a prompt generates", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-media-"));
		const prevHome = process.env.HARNESS_HOME;
		const prevKey = process.env.OPENROUTER_API_KEY;
		const prevFetch = globalThis.fetch;
		process.env.HARNESS_HOME = home;
		process.env.OPENROUTER_API_KEY = "sk-test";
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ data: [{ b64_json: "aaa" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof fetch;
		try {
			const result = await dispatchSlash(fakeHarness({ hasApiKey: true }), "/image a cat");
			expect(result.kind).toBe("media");
			if (result.kind === "media") {
				expect(result.media.kind).toBe("image");
				expect(result.caption).toContain("Image");
			}
		} finally {
			globalThis.fetch = prevFetch;
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
			else process.env.OPENROUTER_API_KEY = prevKey;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("image picker stores the model", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-media-"));
		const prevHome = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		try {
			const result = await applyPickerChoice(
				fakeHarness(),
				"image",
				"google/gemini-2.5-flash-image",
			);
			expect(result).toEqual({ kind: "applied" });
		} finally {
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("mode picker stores the mode without a transcript line", async () => {
		const harness = fakeHarness({ mode: "ask" });
		const result = await applyPickerChoice(harness, "mode", "agent");
		expect(result).toEqual({ kind: "applied" });
		expect(harness.mode).toBe("agent");
	});

	test("skill picker adds a catalog skill and disables project skills", async () => {
		const harness = fakeHarness();
		const added = await applyPickerChoice(harness, "skill", "obra/superpowers@brainstorming");
		expect(added).toEqual({ kind: "text", text: "Loaded frontend-design/SKILL.md" });
		const already = await applyPickerChoice(harness, "skill", "bundled@copywriting");
		expect(already).toEqual({ kind: "text", text: "Disabled copywriting" });
		const userHarness = fakeHarness({
			skills: [
				{
					name: "frontend-design",
					source: "user",
					catalogRef: "anthropics/skills@frontend-design",
				},
			] as HarnessRuntime["skills"],
		});
		const removed = await applyPickerChoice(
			userHarness,
			"skill",
			"anthropics/skills@frontend-design",
		);
		expect(removed).toEqual({ kind: "text", text: "Removed frontend-design" });
		const disabledHarness = fakeHarness({
			disabledSkills: () => ["copywriting"],
		});
		const enabled = await applyPickerChoice(disabledHarness, "skill", "bundled@copywriting");
		expect(enabled).toEqual({ kind: "text", text: "Enabled copywriting" });
	});

	test("runSlashLine opens a skill picker for empty find", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-skill-find-"));
		const prevHome = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		writePopularSkillsCache(
			[{ id: "acme/pack/hello", name: "hello", source: "acme/pack", installs: 9 }],
			process.env,
		);
		try {
			const result = await runSlashLine(fakeHarness(), "/skill find");
			expect(result.kind).toBe("picker");
			if (result.kind === "picker") {
				expect(result.picker).toBe("skill");
				expect(result.title).toBe("Skills");
				expect(result.items.some((item) => item.id === "bundled@copywriting")).toBe(true);
				expect(result.items.some((item) => item.id === "acme/pack/hello")).toBe(true);
			}
		} finally {
			clearPopularSkillsCache();
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			await rm(home, { recursive: true, force: true });
		}
		const prevFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ skills: [] }))) as unknown as typeof fetch;
		try {
			const result = await runSlashLine(fakeHarness(), "/skill find copywriting");
			expect(result.kind).toBe("picker");
			if (result.kind === "picker") {
				expect(result.picker).toBe("skill");
				expect(result.title).toBe("Skills · copywriting");
				expect(result.items.some((item) => item.id === "bundled@copywriting")).toBe(true);
			}
		} finally {
			globalThis.fetch = prevFetch;
		}
		expect(await runSlashLine(fakeHarness(), "/ima")).toEqual({
			kind: "incomplete",
			draft: "/image ",
		});
		expect(await runSlashLine(fakeHarness(), "/asdf")).toEqual({ kind: "hold" });
	});

	test("settings reports a missing key without opening a picker", async () => {
		const result = await dispatchSlash(fakeHarness({ hasApiKey: false }), "/settings");
		expect(result.kind).toBe("text");
		if (result.kind === "text") {
			expect(result.text).toContain("No key");
			expect(result.text).toContain("/settings key");
		}
	});

	test("integrations picker lists MCP servers", async () => {
		const result = await dispatchSlash(fakeHarness(), "/integrations");
		expect(result.kind).toBe("picker");
		if (result.kind === "picker") {
			expect(result.picker).toBe("integration");
			expect(result.items.some((item) => item.id === "linear" && item.label === "Linear")).toBe(
				true,
			);
			expect(result.items.find((item) => item.id === "linear")?.hint).toBe("connect");
		}
		const missing = await dispatchSlash(fakeHarness(), "/integrations not-a-server");
		expect(missing).toEqual({ kind: "text", text: 'No integration "not-a-server".' });
	});

	test("integration picker disconnects a stored connection", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-int-"));
		const prevHome = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		try {
			const { upsertConnection } = await import("../integrations/store.ts");
			upsertConnection({
				id: "linear",
				label: "Linear",
				mcpUrl: "https://mcp.linear.app/mcp",
				accessToken: "tok",
				connectedAt: "2026-01-01T00:00:00.000Z",
			});
			const listed = await dispatchSlash(fakeHarness(), "/integrations");
			expect(listed.kind).toBe("picker");
			if (listed.kind === "picker") {
				expect(listed.items.find((item) => item.id === "linear")?.hint).toBe("on · disconnect");
			}
			const removed = await applyPickerChoice(fakeHarness(), "integration", "linear");
			expect(removed).toEqual({ kind: "text", text: "Disconnected Linear" });
		} finally {
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("clear starts a new session", async () => {
		let cleared = false;
		const result = await dispatchSlash(
			fakeHarness({
				setSession(id) {
					cleared = id === undefined;
				},
			}),
			"/clear",
		);
		expect(result.kind).toBe("clear");
		expect(cleared).toBe(true);
	});
});

describe("HARNESS_MODELS", () => {
	test("lists Auto first", () => {
		expect(HARNESS_MODELS[0]).toEqual({ id: "openrouter/auto", label: "Auto" });
		expect(HARNESS_MODELS.some((model) => model.id === "openrouter/auto-beta")).toBe(true);
	});
});
