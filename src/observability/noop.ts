import type { GenerationHandle, Observability, ScoreInput } from "./types.ts";

const silentSpan: GenerationHandle = {
	update() {},
	end() {},
};

export const noopObservability: Observability = {
	enabled: false,
	startTurn(_options, fn) {
		return fn(silentSpan);
	},
	startSpan(_name, fn) {
		return fn(silentSpan);
	},
	generation(_name, fn) {
		return fn(silentSpan);
	},
	tool(_name, fn) {
		return fn(silentSpan);
	},
	score(_input: ScoreInput) {},
	event() {},
	currentTraceId() {
		return undefined;
	},
	async flush() {},
	async shutdown() {},
};

export function isNoopObservability(obs: Observability): boolean {
	return obs === noopObservability || obs.enabled === false;
}
