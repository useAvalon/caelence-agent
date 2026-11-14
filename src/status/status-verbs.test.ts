import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { turnProgressLabel } from "../cli/tui-progress.ts";
import { DEFAULT_CONFIG } from "../config.ts";
import type { AgentEvent, MainModelProvider } from "../core/events.ts";
import type { ConstructAgent } from "../core/strands.ts";
import { createHarness } from "../runtime.ts";
import {
	resolveStatusVerbPool,
	statusVerbCategories,
	statusVerbCategoryNames,
} from "./categories.ts";
import {
	DEFAULT_STATUS_VERBS,
	DEFAULT_STATUS_VERBS_PER_TURN,
	pickStatusVerbs,
	seededRandom,
	statusVerbAt,
} from "./status-verbs.ts";

describe("status verb data", () => {
	test("the built-in list and the categories are present and clean", () => {
		expect(DEFAULT_STATUS_VERBS.length).toBeGreaterThan(150);
		expect(DEFAULT_STATUS_VERBS).toContain("Pondering");
		expect(new Set(DEFAULT_STATUS_VERBS).size).toBe(DEFAULT_STATUS_VERBS.length);
		const categories = statusVerbCategories();
		expect(statusVerbCategoryNames().length).toBeGreaterThan(100);
		expect(categories["Coffee / Barista"]).toContain("Grinding beans");
		// Left out on purpose: a verb naming another product, and lists that joke about the agent
		// deleting files or misbehaving, which reads badly next to a real agent with file access.
		expect(DEFAULT_STATUS_VERBS).not.toContain("Clauding");
		const names = statusVerbCategoryNames().map((name) => name.toLowerCase());
		expect(names.some((name) => name.startsWith("rogue agent"))).toBe(false);
		expect(names.some((name) => name.startsWith("trolling"))).toBe(false);
		expect(names.some((name) => name.includes("claude"))).toBe(false);
		for (const [name, verbs] of Object.entries(categories)) {
			expect(name.trim()).toBe(name);
			expect(verbs.length).toBeGreaterThan(0);
			expect(verbs.every((verb) => verb.trim().length > 0)).toBe(true);
		}
	});
});

describe("picking verbs", () => {
	test("picks distinct verbs from the pool", () => {
		const picked = pickStatusVerbs(DEFAULT_STATUS_VERBS, 6);
		expect(picked).toHaveLength(6);
		expect(new Set(picked).size).toBe(6);
		expect(picked.every((verb) => DEFAULT_STATUS_VERBS.includes(verb))).toBe(true);
	});

	test("the same seed gives the same pick, a different seed another", () => {
		const first = pickStatusVerbs(DEFAULT_STATUS_VERBS, 6, seededRandom(7));
		expect(pickStatusVerbs(DEFAULT_STATUS_VERBS, 6, seededRandom(7))).toEqual(first);
		expect(pickStatusVerbs(DEFAULT_STATUS_VERBS, 6, seededRandom(8))).not.toEqual(first);
	});

	test("a small or messy pool gives what it has", () => {
		expect(pickStatusVerbs(["Brewing", " Brewing ", "", "Baking"], 6).sort()).toEqual([
			"Baking",
			"Brewing",
		]);
		expect(pickStatusVerbs([], 6)).toEqual([]);
		expect(pickStatusVerbs(["Brewing"], 0)).toEqual([]);
	});

	test("statusVerbAt walks the verbs and falls back to Thinking", () => {
		expect(statusVerbAt(["A", "B"], 0, 3)).toBe("A");
		expect(statusVerbAt(["A", "B"], 2, 3)).toBe("A");
		expect(statusVerbAt(["A", "B"], 3, 3)).toBe("B");
		expect(statusVerbAt(["A", "B"], 6, 3)).toBe("A");
		expect(statusVerbAt([], 4)).toBe("Thinking");
	});
});

describe("resolving the pool from config", () => {
	test("defaults to the built-in list", () => {
		expect(resolveStatusVerbPool(undefined).pool).toEqual([...DEFAULT_STATUS_VERBS]);
	});

	test("off means no verbs", () => {
		expect(resolveStatusVerbPool({ enabled: false, custom: ["Brewing"] }).pool).toEqual([]);
	});

	test("categories match without case, and a typo is reported", () => {
		const { pool, unknown } = resolveStatusVerbPool({
			defaults: false,
			categories: ["coffee / barista", "Coffe"],
		});
		expect(pool).toEqual(statusVerbCategories()["Coffee / Barista"] ?? []);
		expect(unknown).toEqual(["Coffe"]);
	});

	test("custom verbs are added once, and all categories can be asked for", () => {
		const custom = resolveStatusVerbPool({
			defaults: false,
			custom: ["Shipping", "Shipping", " "],
		});
		expect(custom.pool).toEqual(["Shipping"]);
		const all = resolveStatusVerbPool({ categories: "all" });
		expect(all.pool.length).toBeGreaterThan(5000);
		expect(new Set(all.pool).size).toBe(all.pool.length);
	});
});

describe("the TUI progress label", () => {
	test("shows the turn's verbs while thinking and between tools", () => {
		const verbs = ["Brewing", "Baking"];
		expect(
			turnProgressLabel({ tools: [], assistantStarted: false, tick: 0, warmupSeed: 0, verbs }),
		).toBe("Brewing");
		expect(
			turnProgressLabel({ tools: [], assistantStarted: false, tick: 7, warmupSeed: 0, verbs }),
		).toBe("Baking...");
		const done = [{ name: "grep", preview: "x", status: "ok" as const }];
		expect(
			turnProgressLabel({
				tools: done as never,
				assistantStarted: false,
				tick: 0,
				warmupSeed: 0,
				verbs,
			}),
		).toBe("Brewing…");
	});

	test("a running tool and the reply keep their own labels", () => {
		const running = [{ name: "read_file", preview: "a.ts", status: "running" as const }];
		expect(
			turnProgressLabel({
				tools: running as never,
				assistantStarted: false,
				tick: 0,
				warmupSeed: 0,
				verbs: ["Brewing"],
			}),
		).toBe("Reading a.ts");
		expect(
			turnProgressLabel({
				tools: [],
				assistantStarted: true,
				tick: 0,
				warmupSeed: 0,
				verbs: ["Brewing"],
			}),
		).toBe("Writing");
	});
});

describe("the status event", () => {
	const fakeProvider: MainModelProvider = {
		kind: "fake",
		modelId: "fake",
		async *stream() {
			yield { type: "done" };
		},
	};
	const sayOk: ConstructAgent = () => ({
		async run(_message, emit) {
			emit({ kind: "text_delta", text: "ok" });
		},
	});

	async function statusEvents(config: Partial<typeof DEFAULT_CONFIG>): Promise<AgentEvent[]> {
		const cwd = await mkdtemp(join(tmpdir(), "harness-verbs-"));
		try {
			const harness = await createHarness({
				cwd,
				config: { ...DEFAULT_CONFIG, ...config },
				provider: fakeProvider,
				constructAgent: sayOk,
			});
			const events: AgentEvent[] = [];
			await harness.runTurn("hi", (event) => events.push(event));
			harness.close();
			return events;
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	}

	test("a turn starts with one status event carrying verbs from the built-in list", async () => {
		const events = await statusEvents({});
		const status = events.filter((event) => event.kind === "status");
		expect(status).toHaveLength(1);
		const verbs = status[0]?.kind === "status" ? status[0].verbs : [];
		expect(verbs).toHaveLength(DEFAULT_STATUS_VERBS_PER_TURN);
		expect(verbs.every((verb) => DEFAULT_STATUS_VERBS.includes(verb))).toBe(true);
		const kinds = events.map((event) => event.kind);
		expect(kinds.indexOf("status")).toBeLessThan(kinds.indexOf("text_delta"));
	});

	test("config picks the pool and the count", async () => {
		const events = await statusEvents({
			statusVerbs: { defaults: false, custom: ["Shipping", "Polishing", "Testing"], perTurn: 2 },
		});
		const status = events.find((event) => event.kind === "status");
		const verbs = status?.kind === "status" ? status.verbs : [];
		expect(verbs).toHaveLength(2);
		expect(verbs.every((verb) => ["Shipping", "Polishing", "Testing"].includes(verb))).toBe(true);
	});

	test("turned off, no status event is sent", async () => {
		const events = await statusEvents({ statusVerbs: { enabled: false } });
		expect(events.some((event) => event.kind === "status")).toBe(false);
	});
});
