import { fuseRankings } from "./embeddings.ts";
import type { MemoryStore, NewMemoryFact } from "./memory-store.ts";
import { factHash, type MemoryFact, normalizeFactText } from "./store.ts";

/**
 * One level of shared context: a project, the team around it, the whole workspace. Each has its
 * own store, so each keeps its own access rules.
 */
export interface MemoryLayer {
	/** Shown with every fact that comes from this layer ("project", "workspace"). */
	name: string;
	store: MemoryStore;
	/**
	 * Whether `add` may write here. Facts the agent picks up go to the first writable layer. A
	 * wider layer is usually left read-only, so a fact only reaches it when a person promotes it.
	 * Defaults to true for the first layer and false for the rest.
	 */
	writable?: boolean;
}

export interface LayeredMemoryStore extends MemoryStore {
	/** Layer names, narrowest first. */
	readonly layers: readonly string[];
	listByLayer(): Promise<Array<{ layer: string; facts: MemoryFact[] }>>;
	/**
	 * Move a fact to a wider layer, so everything under that layer starts with it. Returns the fact
	 * as it is in the target layer, or undefined when the fact or the layer is not found, or the
	 * target is not wider than where the fact lives. `keep` leaves the original in place.
	 */
	promote(
		id: string,
		toLayer: string,
		options?: { keep?: boolean },
	): Promise<MemoryFact | undefined>;
}

/**
 * Several stores read as one. Layers go narrowest first (project, then team, then workspace):
 * a search asks every layer and puts the narrower one first when both know something, and the
 * same fact held by two layers is returned once, from the narrower.
 */
export function createLayeredMemoryStore(layers: MemoryLayer[]): LayeredMemoryStore {
	if (layers.length === 0) throw new Error("A layered memory store needs at least one layer.");
	const writeIndex = (() => {
		const marked = layers.findIndex((layer) => layer.writable === true);
		if (marked >= 0) return marked;
		return layers[0]?.writable === false ? -1 : 0;
	})();
	const tag = (fact: MemoryFact, layer: string): MemoryFact => ({ ...fact, layer });
	const listLayer = async (layer: MemoryLayer): Promise<MemoryFact[]> =>
		(await layer.store.list().catch(() => [])).map((fact) => tag(fact, layer.name));
	const dedupe = (facts: MemoryFact[]): MemoryFact[] => {
		const seen = new Set<string>();
		return facts.filter((fact) => {
			if (seen.has(fact.hash)) return false;
			seen.add(fact.hash);
			return true;
		});
	};

	return {
		layers: layers.map((layer) => layer.name),
		async listByLayer() {
			return Promise.all(
				layers.map(async (layer) => ({ layer: layer.name, facts: await listLayer(layer) })),
			);
		},
		async list() {
			return dedupe((await Promise.all(layers.map(listLayer))).flat());
		},
		async add(items: NewMemoryFact[]) {
			const target = layers[writeIndex];
			if (!target) return [];
			// What a wider layer already holds is known here too; storing it again adds nothing.
			const wider = new Set<string>();
			for (const layer of layers.slice(writeIndex + 1)) {
				for (const fact of await layer.store.list().catch(() => [])) wider.add(fact.hash);
			}
			const fresh = items.filter((item) => !wider.has(factHash(normalizeFactText(item.text))));
			if (fresh.length === 0) return [];
			return (await target.store.add(fresh)).map((fact) => tag(fact, target.name));
		},
		async remove(id) {
			for (const layer of layers) {
				const removed = await layer.store.remove(id);
				if (removed) return tag(removed, layer.name);
			}
			return undefined;
		},
		async search(query, topK = 10) {
			const ranked = await Promise.all(
				layers.map(async (layer) =>
					(await layer.store.search(query, topK).catch(() => [])).map((fact) =>
						tag(fact, layer.name),
					),
				),
			);
			// Fusing by hash lets a fact two layers agree on rise, and keeps the narrower copy.
			return fuseRankings(ranked, (fact) => fact.hash).slice(0, topK);
		},
		async promote(id, toLayer, options) {
			const targetIndex = layers.findIndex((layer) => layer.name === toLayer);
			const target = layers[targetIndex];
			if (!target) return undefined;
			for (const [index, layer] of layers.entries()) {
				if (index >= targetIndex) break;
				const fact = (await layer.store.list()).find((item) => item.id === id);
				if (!fact) continue;
				const added = await target.store.add([
					{
						text: fact.text,
						scope: fact.scope,
						...(fact.sessionId ? { sessionId: fact.sessionId } : {}),
					},
				]);
				const promoted =
					added[0] ?? (await target.store.list()).find((item) => item.hash === fact.hash);
				if (!promoted) return undefined;
				if (!options?.keep) await layer.store.remove(id);
				return tag(promoted, target.name);
			}
			return undefined;
		},
	};
}
