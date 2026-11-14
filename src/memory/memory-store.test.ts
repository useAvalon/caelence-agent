import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTools } from "../tools/memory.ts";
import {
	cosineSimilarity,
	createOpenAICompatEmbedder,
	type Embedder,
	fuseRankings,
} from "./embeddings.ts";
import {
	createFileMemoryStore,
	createInMemoryMemoryBackend,
	createMemoryStore,
	type MemoryBackend,
} from "./memory-store.ts";
import { listFacts } from "./store.ts";

/**
 * A toy embedder: one axis per topic, so "deploy" and "ship to production" land together even
 * though they share no words.
 */
function topicEmbedder(): Embedder & { calls: string[][] } {
	const topics: Array<[RegExp, number]> = [
		[/deploy|ship|production|release|cloudflare/i, 0],
		[/test|vitest|spec/i, 1],
		[/color|theme|dark|palette/i, 2],
	];
	const calls: string[][] = [];
	return {
		model: "toy-1",
		calls,
		async embed(texts) {
			calls.push(texts);
			return texts.map((text) => {
				const vector = [0, 0, 0, 0.01];
				for (const [pattern, axis] of topics) if (pattern.test(text)) vector[axis] = 1;
				return vector;
			});
		},
	};
}

describe("embedding helpers", () => {
	test("cosine similarity", () => {
		expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
		expect(cosineSimilarity([1, 0], [1])).toBe(0);
		expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
	});

	test("rank fusion prefers what both lists agree on", () => {
		const fused = fuseRankings(
			[
				["a", "b"],
				["b", "c"],
			],
			(item) => item,
		);
		expect(fused).toEqual(["b", "a", "c"]);
	});

	test("the OpenAI-compatible embedder posts the texts and keeps their order", async () => {
		let seen: { url: string; body: { model: string; input: string[] }; auth: string } | undefined;
		const fakeFetch = (async (url: string, init: RequestInit) => {
			seen = {
				url,
				body: JSON.parse(String(init.body)),
				auth: (init.headers as Record<string, string>).Authorization ?? "",
			};
			return new Response(
				JSON.stringify({
					data: [
						{ index: 1, embedding: [2] },
						{ index: 0, embedding: [1] },
					],
				}),
			);
		}) as unknown as typeof fetch;
		const embedder = createOpenAICompatEmbedder({
			apiKey: "key",
			baseUrl: "https://example.test/v1/",
			model: "m",
			fetch: fakeFetch,
		});
		expect(await embedder.embed(["a", "b"])).toEqual([[1], [2]]);
		expect(seen?.url).toBe("https://example.test/v1/embeddings");
		expect(seen?.body).toEqual({ model: "m", input: ["a", "b"] });
		expect(seen?.auth).toBe("Bearer key");
	});

	test("the embedder refuses to call out without a key", async () => {
		const embedder = createOpenAICompatEmbedder({ apiKey: () => "" });
		await expect(embedder.embed(["a"])).rejects.toThrow("No API key");
	});
});

describe("memory store", () => {
	test("keyword recall works without an embedder", async () => {
		const store = createMemoryStore({ backend: createInMemoryMemoryBackend() });
		await store.add([
			{ text: "The project deploys to Cloudflare Workers", scope: "project" },
			{ text: "Prefer vitest for unit tests", scope: "user" },
		]);
		const hits = await store.search("which vitest setup", 1);
		expect(hits[0]?.text).toBe("Prefer vitest for unit tests");
	});

	test("drops duplicates, secrets and noise on add", async () => {
		const store = createMemoryStore({ backend: createInMemoryMemoryBackend() });
		const added = await store.add([
			{ text: "Prefer bun over npm" },
			{ text: "prefer bun over npm" },
			{ text: "tiny" },
			{ text: "api_key = sk-abcdefgh12345678" },
		]);
		expect(added.map((fact) => fact.text)).toEqual(["Prefer bun over npm"]);
		expect(await store.list()).toHaveLength(1);
	});

	test("semantic recall finds a fact that shares no words with the query", async () => {
		const embedder = topicEmbedder();
		const store = createMemoryStore({ backend: createInMemoryMemoryBackend(), embedder });
		await store.add([
			{ text: "Prefer vitest for unit tests", scope: "project" },
			{ text: "The site goes out through Cloudflare Workers", scope: "project" },
			{ text: "Use the dark palette by default", scope: "project" },
		]);
		const hits = await store.search("how do we ship to production", 1);
		expect(hits[0]?.text).toBe("The site goes out through Cloudflare Workers");
	});

	test("vectors are stored on add and not recomputed on search", async () => {
		const embedder = topicEmbedder();
		const backend = createInMemoryMemoryBackend();
		const store = createMemoryStore({ backend, embedder });
		await store.add([{ text: "Prefer vitest for unit tests" }]);
		expect((await backend.load())[0]?.embeddingModel).toBe("toy-1");
		embedder.calls.length = 0;
		await store.search("testing setup");
		expect(embedder.calls).toEqual([["testing setup"]]);
	});

	test("facts stored before embeddings were on are embedded by the first search", async () => {
		const backend = createInMemoryMemoryBackend();
		await createMemoryStore({ backend }).add([
			{ text: "The site goes out through Cloudflare Workers" },
		]);
		expect((await backend.load())[0]?.embedding).toBeUndefined();
		const store = createMemoryStore({ backend, embedder: topicEmbedder() });
		const hits = await store.search("release process", 1);
		expect(hits[0]?.text).toBe("The site goes out through Cloudflare Workers");
		expect((await backend.load())[0]?.embedding).toBeDefined();
	});

	test("a failing embedder falls back to keyword recall and still stores the fact", async () => {
		const broken: Embedder = {
			model: "broken",
			async embed() {
				throw new Error("embeddings are down");
			},
		};
		const store = createMemoryStore({ backend: createInMemoryMemoryBackend(), embedder: broken });
		const added = await store.add([{ text: "Prefer vitest for unit tests" }]);
		expect(added).toHaveLength(1);
		const hits = await store.search("vitest");
		expect(hits[0]?.text).toBe("Prefer vitest for unit tests");
	});

	test("a slow embedder is abandoned for keyword recall", async () => {
		const slow: Embedder = {
			model: "slow",
			embed: () => new Promise(() => undefined),
		};
		const backend = createInMemoryMemoryBackend();
		await createMemoryStore({ backend }).add([{ text: "Prefer vitest for unit tests" }]);
		const store = createMemoryStore({ backend, embedder: slow, embedTimeoutMs: 10 });
		const hits = await store.search("vitest");
		expect(hits[0]?.text).toBe("Prefer vitest for unit tests");
	});

	test("a backend with its own vector index is asked for the nearest facts", async () => {
		const inner = createInMemoryMemoryBackend();
		let asked: { model: string; topK: number } | undefined;
		const backend: MemoryBackend = {
			...inner,
			async nearest(_embedding, model, topK) {
				asked = { model, topK };
				return (await inner.load()).filter((record) => record.text.includes("Cloudflare"));
			},
		};
		const store = createMemoryStore({ backend, embedder: topicEmbedder() });
		await store.add([
			{ text: "Prefer vitest for unit tests" },
			{ text: "The site goes out through Cloudflare Workers" },
		]);
		const hits = await store.search("release process", 1);
		expect(asked).toEqual({ model: "toy-1", topK: 2 });
		expect(hits[0]?.text).toBe("The site goes out through Cloudflare Workers");
	});

	test("search never returns the stored vectors", async () => {
		const store = createMemoryStore({
			backend: createInMemoryMemoryBackend(),
			embedder: topicEmbedder(),
		});
		await store.add([{ text: "Prefer vitest for unit tests" }]);
		const [hit] = await store.search("tests");
		expect(hit).toBeDefined();
		expect("embedding" in (hit ?? {})).toBe(false);
	});
});

describe("file memory store", () => {
	async function withDirs() {
		const cwd = await mkdtemp(join(tmpdir(), "harness-memstore-"));
		const home = await mkdtemp(join(tmpdir(), "harness-memstore-home-"));
		return {
			cwd,
			env: { HARNESS_HOME: home },
			async close() {
				await rm(cwd, { recursive: true, force: true });
				await rm(home, { recursive: true, force: true });
			},
		};
	}

	test("shares the facts files with the existing memory commands", async () => {
		const ctx = await withDirs();
		try {
			const store = createFileMemoryStore({ cwd: ctx.cwd, env: ctx.env });
			await store.add([
				{ text: "Prefer bun over npm", scope: "user" },
				{ text: "Tests live next to the source", scope: "project" },
			]);
			expect(listFacts(ctx.cwd, ctx.env).map((fact) => fact.scope)).toEqual(["user", "project"]);
			const [first] = await store.list();
			expect(await store.remove(first?.id ?? "")).toMatchObject({ text: "Prefer bun over npm" });
			expect(listFacts(ctx.cwd, ctx.env)).toHaveLength(1);
		} finally {
			await ctx.close();
		}
	});

	test("keeps vectors beside the facts and drops them with the fact", async () => {
		const ctx = await withDirs();
		try {
			const store = createFileMemoryStore({
				cwd: ctx.cwd,
				env: ctx.env,
				embedder: topicEmbedder(),
			});
			const [fact] = await store.add([
				{ text: "The site goes out through Cloudflare Workers", scope: "project" },
			]);
			const vectorsFile = join(ctx.cwd, ".harness", "memory", "vectors.json");
			const stored = JSON.parse(await readFile(vectorsFile, "utf8"));
			expect(stored.model).toBe("toy-1");
			expect(Object.keys(stored.vectors)).toEqual([fact?.id ?? ""]);
			const facts = JSON.parse(
				await readFile(join(ctx.cwd, ".harness", "memory", "facts.json"), "utf8"),
			);
			expect("embedding" in facts.facts[0]).toBe(false);

			const hits = await store.search("how do we ship to production", 1);
			expect(hits[0]?.id).toBe(fact?.id);

			await store.remove(fact?.id ?? "");
			expect(JSON.parse(await readFile(vectorsFile, "utf8")).vectors).toEqual({});
		} finally {
			await ctx.close();
		}
	});
});

describe("memory tools", () => {
	test("memory_save stores a fact and memory_search finds it", async () => {
		const store = createMemoryStore({ backend: createInMemoryMemoryBackend() });
		const [search, save] = createMemoryTools(store, { sessionId: () => "sess_1" });
		expect(search?.name).toBe("memory_search");
		expect(search?.annotations.readOnlyHint).toBe(true);
		const saved = await save?.handler({ text: "Prefer vitest for unit tests", scope: "user" });
		expect(saved?.structuredContent).toEqual({ saved: true });
		expect((await store.list())[0]).toMatchObject({ scope: "user", sessionId: "sess_1" });
		const found = await search?.handler({ query: "vitest" });
		expect(found?.structuredContent).toMatchObject({
			facts: [{ text: "Prefer vitest for unit tests", scope: "user" }],
		});
	});

	test("memory_save says why nothing was stored", async () => {
		const store = createMemoryStore({ backend: createInMemoryMemoryBackend() });
		const save = createMemoryTools(store)[1];
		const result = await save?.handler({ text: "password: hunter2hunter2" });
		expect(result?.structuredContent).toMatchObject({ saved: false });
		expect((await save?.handler({ text: " " }))?.isError).toBe(true);
	});
});
