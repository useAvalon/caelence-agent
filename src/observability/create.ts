import { tryCreateLangfuseObservability } from "./langfuse.ts";
import { noopObservability } from "./noop.ts";
import type { CreateObservabilityOptions, Observability } from "./types.ts";
import { langfuseKeysPresent } from "./version.ts";

let singleton: Observability | undefined;
let singletonPromise: Promise<Observability> | undefined;

/**
 * Keys present → Langfuse (if packages load). Missing keys or `enabled: false` → no-op.
 * Safe to call more than once; subsequent calls reuse the first instance.
 */
export async function createObservability(
	options: CreateObservabilityOptions = {},
): Promise<Observability> {
	if (options.enabled === false) return noopObservability;
	const env = options.env ?? process.env;
	if (!langfuseKeysPresent(env)) return noopObservability;
	const created = await tryCreateLangfuseObservability(options);
	return created ?? noopObservability;
}

/** Process-wide observer. The CLI starts this once at boot. */
export async function startObservability(
	options: CreateObservabilityOptions = {},
): Promise<Observability> {
	if (singleton) return singleton;
	if (!singletonPromise) {
		singletonPromise = createObservability(options).then((obs) => {
			singleton = obs;
			return obs;
		});
	}
	return singletonPromise;
}

export function getObservability(): Observability {
	return singleton ?? noopObservability;
}

/** Test-only: drop the process singleton. */
export function resetObservabilityForTests(): void {
	singleton = undefined;
	singletonPromise = undefined;
}
