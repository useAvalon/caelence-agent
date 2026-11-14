import { describe, expect, test } from "bun:test";
import type { MainModelProvider, ProviderTurnRequest } from "../core/events.ts";
import { formatMemoryBriefs, memoryBriefSystem, synthesizeMemoryBrief } from "./brief.ts";
import { createLayeredMemoryStore } from "./layered.ts";
import { createInMemoryMemoryBackend, createMemoryStore } from "./memory-store.ts";

function stores() {
	const project = createMemoryStore({ backend: createInMemoryMemoryBackend() });
	const workspace = createMemoryStore({ backend: createInMemoryMemoryBackend() });
	const layered = createLayeredMemoryStore([
		{ name: "project", store: project },
		{ name: "workspace", store: workspace },
	]);
	return { project, workspace, layered };
}

describe("layered memory", () => {
	test("needs a layer", () => {
		expect(() => createLayeredMemoryStore([])).toThrow();
	});

	test("the agent's facts go to the narrowest layer only", async () => {
		const { project, workspace, layered } = stores();
		const added = await layered.add([{ text: "The hero uses a full-bleed photo" }]);
		expect(added[0]?.layer).toBe("project");
		expect(await project.list()).toHaveLength(1);
		expect(await workspace.list()).toHaveLength(0);
	});

	test("a fact the workspace already holds is not stored again in the project", async () => {
		const { project, workspace, layered } = stores();
		await workspace.add([{ text: "The brand voice is plain and direct" }]);
		expect(await layered.add([{ text: "the brand voice is plain and direct" }])).toHaveLength(0);
		expect(await project.list()).toHaveLength(0);
	});

	test("search reads every layer, tags where a fact came from, and puts the narrower first", async () => {
		const { workspace, layered } = stores();
		await workspace.add([{ text: "Buttons use the green accent colour" }]);
		await layered.add([{ text: "Buttons on this site use the orange accent colour" }]);
		const hits = await layered.search("which accent colour for buttons", 2);
		expect(hits.map((fact) => fact.layer)).toEqual(["project", "workspace"]);
		expect(hits[0]?.text).toContain("orange");
	});

	test("list and listByLayer show both layers", async () => {
		const { workspace, layered } = stores();
		await workspace.add([{ text: "The brand voice is plain and direct" }]);
		await layered.add([{ text: "The hero uses a full-bleed photo" }]);
		expect((await layered.list()).map((fact) => fact.layer)).toEqual(["project", "workspace"]);
		const byLayer = await layered.listByLayer();
		expect(byLayer.map((row) => [row.layer, row.facts.length])).toEqual([
			["project", 1],
			["workspace", 1],
		]);
	});

	test("promote moves a fact to the wider layer", async () => {
		const { project, workspace, layered } = stores();
		const [fact] = await layered.add([{ text: "Deploys go through Cloudflare Workers" }]);
		const promoted = await layered.promote(fact?.id ?? "", "workspace");
		expect(promoted).toMatchObject({
			layer: "workspace",
			text: "Deploys go through Cloudflare Workers",
		});
		expect(await project.list()).toHaveLength(0);
		expect((await workspace.list()).map((item) => item.text)).toEqual([
			"Deploys go through Cloudflare Workers",
		]);
	});

	test("promote can keep the original, and joins a copy the wider layer already has", async () => {
		const { project, workspace, layered } = stores();
		await workspace.add([{ text: "Deploys go through Cloudflare Workers" }]);
		// Written straight to the project store, as an older fact would have been.
		const [fact] = await project.add([{ text: "Deploys go through Cloudflare Workers" }]);
		const promoted = await layered.promote(fact?.id ?? "", "workspace", { keep: true });
		expect(promoted?.layer).toBe("workspace");
		expect(await workspace.list()).toHaveLength(1);
		expect(await project.list()).toHaveLength(1);
	});

	test("promote refuses an unknown fact, an unknown layer, and a move that is not wider", async () => {
		const { workspace, layered } = stores();
		const [fact] = await layered.add([{ text: "The hero uses a full-bleed photo" }]);
		const [wide] = await workspace.add([{ text: "The brand voice is plain and direct" }]);
		expect(await layered.promote("mem_missing", "workspace")).toBeUndefined();
		expect(await layered.promote(fact?.id ?? "", "galaxy")).toBeUndefined();
		expect(await layered.promote(fact?.id ?? "", "project")).toBeUndefined();
		expect(await layered.promote(wide?.id ?? "", "project")).toBeUndefined();
	});

	test("remove finds the fact in whichever layer holds it", async () => {
		const { workspace, layered } = stores();
		const [wide] = await workspace.add([{ text: "The brand voice is plain and direct" }]);
		expect((await layered.remove(wide?.id ?? ""))?.layer).toBe("workspace");
		expect(await workspace.list()).toHaveLength(0);
		expect(await layered.remove("mem_missing")).toBeUndefined();
	});

	test("a read-only first layer stores nothing", async () => {
		const project = createMemoryStore({ backend: createInMemoryMemoryBackend() });
		const layered = createLayeredMemoryStore([
			{ name: "project", store: project, writable: false },
		]);
		expect(await layered.add([{ text: "The hero uses a full-bleed photo" }])).toHaveLength(0);
	});

	test("a layer that fails to read does not break the others", async () => {
		const { project } = stores();
		await project.add([{ text: "The hero uses a full-bleed photo" }]);
		const broken = {
			list: async () => Promise.reject(new Error("down")),
			add: async () => [],
			remove: async () => undefined,
			search: async () => Promise.reject(new Error("down")),
		};
		const layered = createLayeredMemoryStore([
			{ name: "project", store: project },
			{ name: "workspace", store: broken },
		]);
		expect(await layered.search("hero photo")).toHaveLength(1);
		expect(await layered.list()).toHaveLength(1);
	});
});

describe("memory briefs", () => {
	function provider(reply: string, seen?: ProviderTurnRequest[]): MainModelProvider {
		return {
			kind: "fake",
			modelId: "fake",
			async *stream(request) {
				seen?.push(request);
				yield { type: "text_delta", text: reply };
				yield { type: "done" };
			},
		};
	}
	const fact = (text: string) => ({
		id: `mem_${text.length}`,
		hash: text,
		text,
		scope: "project" as const,
		createdAt: new Date(0).toISOString(),
	});

	test("sends the facts oldest first and returns the model's brief", async () => {
		const seen: ProviderTurnRequest[] = [];
		const brief = await synthesizeMemoryBrief({
			facts: [fact("Uses a dark palette"), fact("Deploys to Cloudflare")],
			provider: provider("  Dark palette. Deploys to Cloudflare.  ", seen),
			subject: "this project",
		});
		expect(brief).toBe("Dark palette. Deploys to Cloudflare.");
		expect(seen[0]?.messages[0]?.content).toBe("- Uses a dark palette\n- Deploys to Cloudflare");
		expect(seen[0]?.system).toBe(memoryBriefSystem("this project"));
		expect(seen[0]?.system).toContain("this project");
	});

	test("no facts means no model call and no brief", async () => {
		const seen: ProviderTurnRequest[] = [];
		expect(
			await synthesizeMemoryBrief({ facts: [], provider: provider("x", seen), subject: "it" }),
		).toBe("");
		expect(seen).toHaveLength(0);
	});

	test("a model error gives an empty brief, and an overlong one is cut", async () => {
		const failing: MainModelProvider = {
			kind: "fake",
			modelId: "fake",
			async *stream() {
				yield { type: "error", message: "nope" };
			},
		};
		expect(
			await synthesizeMemoryBrief({
				facts: [fact("Uses a dark palette")],
				provider: failing,
				subject: "it",
			}),
		).toBe("");
		const long = await synthesizeMemoryBrief({
			facts: [fact("Uses a dark palette")],
			provider: provider(Array.from({ length: 100 }, () => "word").join(" ")),
			subject: "it",
			maxWords: 10,
		});
		expect(long.split(" ")).toHaveLength(16);
		expect(long.endsWith("…")).toBe(true);
	});

	test("formats briefs as sections and skips empty ones", () => {
		expect(
			formatMemoryBriefs([
				{ title: "Workspace", text: "Plain voice." },
				{ title: "Team", text: "  " },
				{ title: "Project", text: "Dark palette." },
			]),
		).toBe("### Workspace\nPlain voice.\n\n### Project\nDark palette.");
	});
});
