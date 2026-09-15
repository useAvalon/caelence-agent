import { postDeterministicScores } from "./judges.ts";
import type { Observability } from "./types.ts";

export interface ExperimentItem {
	id?: string;
	input: unknown;
	expectedOutput?: unknown;
	metadata?: Record<string, unknown>;
}

export interface ExperimentEvaluator {
	name: string;
	run: (args: {
		input: unknown;
		output: unknown;
		expectedOutput?: unknown;
		metadata?: Record<string, unknown>;
	}) => { value: number; comment?: string } | Promise<{ value: number; comment?: string }>;
}

export interface ExperimentResult {
	name: string;
	ok: boolean;
	itemResults: Array<{
		id?: string;
		output: unknown;
		scores: Record<string, number>;
		error?: string;
	}>;
	aggregates: Record<string, number>;
}

export async function runLocalExperiment(input: {
	name: string;
	items: ExperimentItem[];
	task: (item: ExperimentItem) => Promise<unknown>;
	evaluators?: ExperimentEvaluator[];
	observability?: Observability;
	/** Fail the run when this named aggregate is below the threshold. */
	gate?: { score: string; min: number };
}): Promise<ExperimentResult> {
	const obs = input.observability;
	const itemResults: ExperimentResult["itemResults"] = [];
	await (obs
		? obs.startTurn(
				{ name: input.name, tags: ["experiment"], metadata: { requestType: "eval" } },
				runItems,
			)
		: runItems());

	async function runItems(): Promise<void> {
		for (const item of input.items) {
			try {
				const output = await input.task(item);
				const scores: Record<string, number> = {};
				for (const evaluator of input.evaluators ?? []) {
					const result = await evaluator.run({
						input: item.input,
						output,
						expectedOutput: item.expectedOutput,
						metadata: item.metadata,
					});
					scores[evaluator.name] = result.value;
					obs?.score({
						name: evaluator.name,
						value: result.value,
						comment: result.comment,
						dataType: "NUMERIC",
					});
				}
				itemResults.push({ id: item.id, output, scores });
			} catch (err) {
				itemResults.push({
					id: item.id,
					output: undefined,
					scores: {},
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}

	const aggregates: Record<string, number> = {};
	const names = new Set(itemResults.flatMap((r) => Object.keys(r.scores)));
	for (const name of names) {
		const values = itemResults
			.map((r) => r.scores[name])
			.filter((n): n is number => n !== undefined);
		if (values.length === 0) continue;
		aggregates[name] = values.reduce((a, b) => a + b, 0) / values.length;
	}
	aggregates.item_success =
		itemResults.filter((r) => !r.error).length / Math.max(1, itemResults.length);
	if (obs) postDeterministicScores(obs, aggregates);
	await obs?.flush();

	const gateOk =
		!input.gate ||
		(aggregates[input.gate.score] !== undefined && aggregates[input.gate.score]! >= input.gate.min);
	return {
		name: input.name,
		ok: gateOk && itemResults.every((r) => !r.error),
		itemResults,
		aggregates,
	};
}

export const DEFAULT_GATES = {
	build_success: 0.98,
	instruction_following: 0.85,
	visual_quality: 0.85,
	costIncrease: 0.2,
} as const;
