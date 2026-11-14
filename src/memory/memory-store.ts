import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cosineSimilarity, type Embedder, fuseRankings } from "./embeddings.ts";
import {
	completeHits,
	deleteFact,
	insertFacts,
	keywordHits,
	listFacts,
	type MemoryFact,
	type MemoryScope,
	memoryPathForScope,
	prepareFacts,
	rankFacts,
} from "./store.ts";

export interface NewMemoryFact {
	text: string;
	scope?: MemoryScope;
	sessionId?: string;
}

/** What the agent needs from memory. Hosts supply their own; the harness ships a file-backed one. */
export interface MemoryStore {
	list(): Promise<MemoryFact[]>;
	/** Store new facts. Duplicates, secrets and noise are dropped. Returns what was stored. */
	add(items: NewMemoryFact[]): Promise<MemoryFact[]>;
	remove(id: string): Promise<MemoryFact | undefined>;
	/** The facts most relevant to the query, best first. Never throws. */
	search(query: string, topK?: number): Promise<MemoryFact[]>;
}

/** A stored fact with its vector, when it has one. */
export interface MemoryRecord extends MemoryFact {
	embedding?: number[];
	embeddingModel?: string;
}

export interface MemoryEmbeddingRow {
	id: string;
	embedding: number[];
	embeddingModel: string;
}

/**
 * Where facts live. A host implements this over its own database, scoped to one user or project;
 * `createMemoryStore` adds the validation, deduplication and ranking on top.
 */
export interface MemoryBackend {
	load(): Promise<MemoryRecord[]>;
	insert(facts: MemoryFact[]): Promise<void>;
	remove(id: string): Promise<MemoryFact | undefined>;
	/** Store vectors for facts already inserted. Without it vectors are recomputed each search. */
	saveEmbeddings?(rows: MemoryEmbeddingRow[]): Promise<void>;
	/**
	 * Nearest facts to a query vector, best first. A backend with a vector index (pgvector, for
	 * one) implements this so a search does not load every fact. Without it the store ranks the
	 * loaded records itself, which is fine up to a few thousand facts per scope.
	 */
	nearest?(embedding: number[], embeddingModel: string, topK: number): Promise<MemoryFact[]>;
}

export interface CreateMemoryStoreOptions {
	backend: MemoryBackend;
	/** Adds semantic recall. Without one, recall is keyword-only. */
	embedder?: Embedder;
	/** Facts less similar than this to the query are not semantic hits. Default 0.25. */
	minSimilarity?: number;
	/** Give up on the embedding call after this long and answer from keywords. Default 2500. */
	embedTimeoutMs?: number;
}

const DEFAULT_MIN_SIMILARITY = 0.25;
const DEFAULT_EMBED_TIMEOUT_MS = 2500;
/** Facts embedded lazily in one search, so the first search over old facts stays bounded. */
const MAX_LAZY_EMBEDS = 256;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("embedding timed out")), ms);
	});
	return Promise.race([work, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

function toFact(record: MemoryRecord): MemoryFact {
	const { embedding: _embedding, embeddingModel: _model, ...fact } = record;
	return fact;
}

export function createMemoryStore(options: CreateMemoryStoreOptions): MemoryStore {
	const { backend, embedder } = options;
	const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
	const embedTimeoutMs = options.embedTimeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;

	const embedAndSave = async (facts: MemoryFact[]): Promise<Map<string, number[]>> => {
		const vectors = new Map<string, number[]>();
		if (!embedder || facts.length === 0) return vectors;
		const embedded = await embedder.embed(facts.map((fact) => fact.text));
		const rows: MemoryEmbeddingRow[] = [];
		facts.forEach((fact, index) => {
			const embedding = embedded[index];
			if (!embedding) return;
			vectors.set(fact.id, embedding);
			rows.push({ id: fact.id, embedding, embeddingModel: embedder.model });
		});
		if (rows.length > 0) await backend.saveEmbeddings?.(rows);
		return vectors;
	};

	/** Semantic hits, best first. Throws when the embedder or backend fails. */
	const semanticHits = async (
		records: MemoryRecord[],
		query: string,
		topK: number,
	): Promise<MemoryFact[]> => {
		if (!embedder) return [];
		const [queryVector] = await embedder.embed([query]);
		if (!queryVector) return [];
		if (backend.nearest) return backend.nearest(queryVector, embedder.model, topK);
		const missing = records
			.filter((record) => !record.embedding || record.embeddingModel !== embedder.model)
			.slice(-MAX_LAZY_EMBEDS);
		const fresh = await embedAndSave(missing);
		return records
			.map((record) => {
				const vector =
					fresh.get(record.id) ??
					(record.embeddingModel === embedder.model ? record.embedding : undefined);
				return { record, score: vector ? cosineSimilarity(queryVector, vector) : 0 };
			})
			.filter((row) => row.score >= minSimilarity)
			.sort((a, b) => b.score - a.score)
			.slice(0, topK)
			.map((row) => row.record);
	};

	return {
		async list() {
			return (await backend.load()).map(toFact);
		},
		async add(items) {
			const known = new Set((await backend.load()).map((record) => record.hash));
			const facts = prepareFacts(known, items);
			if (facts.length === 0) return [];
			await backend.insert(facts);
			// The facts are stored either way; a missing vector is filled in by a later search.
			await embedAndSave(facts).catch(() => undefined);
			return facts;
		},
		remove: (id) => backend.remove(id),
		async search(query, topK = 10) {
			let records: MemoryRecord[];
			try {
				records = await backend.load();
			} catch {
				return [];
			}
			if (records.length === 0) return [];
			const keyword = keywordHits(records, query);
			if (!embedder || !query.trim()) return rankFacts(records, query, topK).map(toFact);
			let semantic: MemoryFact[] = [];
			try {
				semantic = await withTimeout(semanticHits(records, query, topK * 2), embedTimeoutMs);
			} catch {
				return rankFacts(records, query, topK).map(toFact);
			}
			const byId = new Map(records.map((record) => [record.id, record]));
			const fused = fuseRankings<MemoryFact>([semantic, keyword ?? []], (fact) => fact.id)
				.map((fact) => byId.get(fact.id) ?? fact)
				.slice(0, topK);
			return completeHits(fused, records, topK).map(toFact);
		},
	};
}

/** Facts held in memory only. For tests, and for hosts that want recall inside one process. */
export function createInMemoryMemoryBackend(seed: MemoryRecord[] = []): MemoryBackend {
	const records: MemoryRecord[] = [...seed];
	return {
		async load() {
			return records.map((record) => ({ ...record }));
		},
		async insert(facts) {
			records.push(...facts);
		},
		async remove(id) {
			const index = records.findIndex((record) => record.id === id);
			if (index < 0) return undefined;
			const [removed] = records.splice(index, 1);
			return removed ? toFact(removed) : undefined;
		},
		async saveEmbeddings(rows) {
			for (const row of rows) {
				const record = records.find((item) => item.id === row.id);
				if (!record) continue;
				record.embedding = row.embedding;
				record.embeddingModel = row.embeddingModel;
			}
		},
	};
}

interface VectorsFile {
	model?: string;
	vectors?: Record<string, number[]>;
}

function vectorsPath(factsPath: string): string {
	return resolve(factsPath, "..", "vectors.json");
}

function readVectors(factsPath: string): VectorsFile {
	const path = vectorsPath(factsPath);
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as VectorsFile;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writeVectors(factsPath: string, file: VectorsFile): void {
	const path = vectorsPath(factsPath);
	mkdirSync(resolve(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(file)}\n`);
}

/**
 * The harness's own facts files (`~/.harness/memory/facts.json` and `.harness/memory/facts.json`).
 * Vectors sit beside each in `vectors.json`, so the facts files stay readable and unchanged.
 */
export function createFileMemoryBackend(
	cwd: string,
	env: Record<string, string | undefined> = process.env,
): MemoryBackend {
	const scopes = ["user", "project"] as const;
	return {
		async load() {
			const byScope = new Map<MemoryScope, VectorsFile>();
			for (const scope of scopes) {
				byScope.set(scope, readVectors(memoryPathForScope(cwd, scope, env)));
			}
			return listFacts(cwd, env).map((fact): MemoryRecord => {
				const file = byScope.get(fact.scope);
				const embedding = file?.vectors?.[fact.id];
				return embedding && file?.model ? { ...fact, embedding, embeddingModel: file.model } : fact;
			});
		},
		async insert(facts) {
			insertFacts(cwd, facts, env);
		},
		async remove(id) {
			const removed = deleteFact(cwd, id, env);
			if (!removed) return undefined;
			const path = memoryPathForScope(cwd, removed.scope, env);
			const file = readVectors(path);
			if (file.vectors?.[removed.id]) {
				delete file.vectors[removed.id];
				writeVectors(path, file);
			}
			return removed;
		},
		async saveEmbeddings(rows) {
			if (rows.length === 0) return;
			const scopeOf = new Map(listFacts(cwd, env).map((fact) => [fact.id, fact.scope]));
			for (const scope of scopes) {
				const mine = rows.filter((row) => scopeOf.get(row.id) === scope);
				if (mine.length === 0) continue;
				const model = mine[0]?.embeddingModel;
				const path = memoryPathForScope(cwd, scope, env);
				const current = readVectors(path);
				// A new embedding model starts a new vector space; the old vectors cannot be compared.
				const vectors = current.model === model ? { ...(current.vectors ?? {}) } : {};
				for (const row of mine) vectors[row.id] = row.embedding;
				writeVectors(path, { model, vectors });
			}
		},
	};
}

/** The default store: the facts files on disk, with semantic recall when given an embedder. */
export function createFileMemoryStore(options: {
	cwd: string;
	env?: Record<string, string | undefined>;
	embedder?: Embedder;
}): MemoryStore {
	return createMemoryStore({
		backend: createFileMemoryBackend(options.cwd, options.env),
		...(options.embedder ? { embedder: options.embedder } : {}),
	});
}
