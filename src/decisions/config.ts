import type { HarnessConfig } from "../config.ts";
import { DEFAULT_JEV_MODEL, type FetchImpl, submitDecisions } from "./client.ts";

export interface HarnessDecisionsConfig {
	/** Master switch. On by default whenever an OpenRouter key is set. */
	enabled?: boolean;
	/** Decision model. Default is a pinned Jev release. */
	model?: string;
	/** Floor for routing and shortcut choices. Default 0.6. */
	minConfidence?: number;
	/** Probability of "safe to run" needed to skip a permission prompt. Default 0.9. */
	approvalThreshold?: number;
	/** Let a host plug in direct-tool shortcuts. Default on. */
	shortcuts?: boolean;
	/** Skip the permission prompt when the tool call clearly matches the request. Default on. */
	approvals?: boolean;
	/** Skip memory extraction when the turn has nothing durable. Default on. */
	memory?: boolean;
}

export interface ResolvedDecisions {
	model: string;
	minConfidence: number;
	approvalThreshold: number;
	shortcuts: boolean;
	approvals: boolean;
	memory: boolean;
	apiKey: string;
	baseUrl: string;
	fetchImpl?: FetchImpl;
}

function offByEnv(env: Record<string, string | undefined>): boolean {
	const raw = env.HARNESS_JEV?.trim().toLowerCase();
	return raw === "0" || raw === "false" || raw === "off";
}

function unit(value: number | undefined, fallback: number): number {
	return typeof value === "number" && value > 0 && value <= 1 ? value : fallback;
}

/** On unless the config or HARNESS_JEV=0 turns it off, or there is no OpenRouter key. */
export function resolveDecisions(
	config: Pick<HarnessConfig, "decisions">,
	apiKey: string,
	baseUrl: string,
	env: Record<string, string | undefined> = process.env,
	fetchImpl?: FetchImpl,
): ResolvedDecisions | undefined {
	if (offByEnv(env)) return undefined;
	const block = config.decisions;
	if (block?.enabled === false) return undefined;
	if (!apiKey.trim()) return undefined;
	return {
		model: (typeof block?.model === "string" ? block.model.trim() : "") || DEFAULT_JEV_MODEL,
		minConfidence: unit(block?.minConfidence, 0.6),
		approvalThreshold: unit(block?.approvalThreshold, 0.9),
		shortcuts: block?.shortcuts !== false,
		approvals: block?.approvals !== false,
		memory: block?.memory !== false,
		apiKey,
		baseUrl,
		...(fetchImpl ? { fetchImpl } : {}),
	};
}

/** Bind the key, model, and URL so a caller only supplies state and questions. */
export function decide(
	resolved: ResolvedDecisions,
	state: Record<string, unknown>,
	questions: Record<string, unknown>,
	signal?: AbortSignal,
) {
	return submitDecisions({
		apiKey: resolved.apiKey,
		baseUrl: resolved.baseUrl,
		model: resolved.model,
		state,
		questions,
		signal,
		fetchImpl: resolved.fetchImpl,
	});
}
