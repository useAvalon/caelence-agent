import { DEFAULT_STATUS_VERBS } from "./default-verbs.ts";

export { DEFAULT_STATUS_VERBS };

/** What a UI shows when a turn carries no verbs. */
export const FALLBACK_STATUS_VERB = "Thinking";

/** How many verbs a turn gets. A UI rotates through them while the agent is thinking. */
export const DEFAULT_STATUS_VERBS_PER_TURN = 6;

export interface StatusVerbsConfig {
	/** false sends no verbs; UIs then show their plain "Thinking". Default on. */
	enabled?: boolean;
	/** Include the built-in list. Default true. */
	defaults?: boolean;
	/** Themed lists to add, by name ("Coffee / Barista"), or "all". Names match without case. */
	categories?: readonly string[] | "all";
	/** Your own verbs or short phrases, added to the pool. */
	custom?: readonly string[];
	/** Verbs sent with each turn. Default 6. */
	perTurn?: number;
}

/**
 * Pick `count` different verbs from the pool, in random order. `random` returns a number in
 * [0, 1) and exists so a test can make the pick repeatable.
 */
export function pickStatusVerbs(
	pool: readonly string[],
	count = DEFAULT_STATUS_VERBS_PER_TURN,
	random: () => number = Math.random,
): string[] {
	const unique = [...new Set(pool.map((verb) => verb.trim()).filter(Boolean))];
	const wanted = Math.max(0, Math.min(Math.floor(count), unique.length));
	// A partial Fisher-Yates shuffle: only the first `wanted` places are settled.
	for (let i = 0; i < wanted; i += 1) {
		const j = i + Math.floor(random() * (unique.length - i));
		const held = unique[i] as string;
		unique[i] = unique[j] as string;
		unique[j] = held;
	}
	return unique.slice(0, wanted);
}

/** A repeatable random source, for UIs that pick from a seed such as the turn number. */
export function seededRandom(seed: number): () => number {
	let state = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The verb to show now: the turn's verbs in order, one every `every` ticks. */
export function statusVerbAt(verbs: readonly string[], tick: number, every = 1): string {
	if (verbs.length === 0) return FALLBACK_STATUS_VERB;
	const step = Math.floor(Math.max(0, tick) / Math.max(1, every));
	return verbs[step % verbs.length] ?? FALLBACK_STATUS_VERB;
}
