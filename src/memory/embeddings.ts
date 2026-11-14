import { OPENROUTER_DEFAULT_BASE_URL } from "../config.ts";
import { PRODUCT_NAME } from "../product.ts";

/** Turns text into vectors. One vector per input, in the same order. */
export interface Embedder {
	/** Names the vector space. Vectors from two models are never compared. */
	readonly model: string;
	embed(texts: string[]): Promise<number[][]>;
}

export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

const EMBED_BATCH = 96;

/**
 * An embedder for any OpenAI-compatible `/embeddings` endpoint. OpenRouter is the default.
 * The texts are sent to that provider, so a host turns this on deliberately.
 */
export function createOpenAICompatEmbedder(options: {
	apiKey: string | (() => string);
	baseUrl?: string;
	model?: string;
	fetch?: typeof fetch;
}): Embedder {
	const baseUrl = (options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
	const model = options.model?.trim() || DEFAULT_EMBEDDING_MODEL;
	const doFetch = options.fetch ?? fetch;
	const embedBatch = async (texts: string[]): Promise<number[][]> => {
		const apiKey = typeof options.apiKey === "function" ? options.apiKey() : options.apiKey;
		if (!apiKey.trim()) throw new Error("No API key for embeddings.");
		const res = await doFetch(`${baseUrl}/embeddings`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://caelence.com",
				"X-Title": `${PRODUCT_NAME} memory`,
			},
			body: JSON.stringify({ model, input: texts }),
		});
		if (!res.ok) {
			const body = await res.text();
			throw new Error(`Embeddings ${res.status}: ${body.slice(0, 300)}`);
		}
		const json = (await res.json()) as {
			data?: Array<{ index?: number; embedding?: unknown }>;
		};
		const rows = json.data ?? [];
		const out: number[][] = new Array(texts.length);
		rows.forEach((row, position) => {
			const index = typeof row.index === "number" ? row.index : position;
			if (Array.isArray(row.embedding) && index >= 0 && index < texts.length) {
				out[index] = row.embedding as number[];
			}
		});
		for (let i = 0; i < texts.length; i += 1) {
			if (!Array.isArray(out[i])) throw new Error("Embeddings reply was missing a vector.");
		}
		return out;
	};
	return {
		model,
		async embed(texts) {
			const out: number[][] = [];
			for (let i = 0; i < texts.length; i += EMBED_BATCH) {
				out.push(...(await embedBatch(texts.slice(i, i + EMBED_BATCH))));
			}
			return out;
		},
	};
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
	if (a.length === 0 || a.length !== b.length) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i += 1) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		dot += x * y;
		normA += x * x;
		normB += y * y;
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / Math.sqrt(normA * normB);
}

/**
 * Merge ranked lists into one. An item's score is the sum of 1 / (k + rank) over the lists it
 * appears in, so something both lists like beats something one list loves.
 */
export function fuseRankings<T>(lists: T[][], keyOf: (item: T) => string, k = 60): T[] {
	const scores = new Map<string, { item: T; score: number }>();
	for (const list of lists) {
		list.forEach((item, rank) => {
			const key = keyOf(item);
			const row = scores.get(key) ?? { item, score: 0 };
			row.score += 1 / (k + rank + 1);
			scores.set(key, row);
		});
	}
	return [...scores.values()].sort((a, b) => b.score - a.score).map((row) => row.item);
}
