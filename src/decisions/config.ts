import type { HarnessConfig } from "../config.ts";
import { JEV_MODEL } from "./jev.ts";

export interface ResolvedHarnessDecisions {
	model: string;
	minConfidence: number;
	shortcuts: boolean;
	approvals: boolean;
	apiKey: string;
	baseUrl: string;
}

/** OpenRouter Jev ([docs](https://openrouter.ai/docs/guides/community/jev)) — on unless config or env disables it. */
export function resolveHarnessDecisions(
	config: HarnessConfig,
	apiKey: string,
	baseUrl: string,
	env: Record<string, string | undefined> = process.env,
): ResolvedHarnessDecisions | undefined {
	if (env.HARNESS_JEV?.trim().toLowerCase() === "0") return undefined;
	if (env.HARNESS_JEV?.trim().toLowerCase() === "false") return undefined;
	const block = config.decisions;
	if (block?.enabled === false) return undefined;
	if (!apiKey.trim()) return undefined;
	const shortcuts = block?.shortcuts !== false;
	return {
		model: block?.model?.trim() || JEV_MODEL,
		minConfidence: block?.minConfidence ?? 0.6,
		shortcuts,
		approvals: block?.approvals !== false,
		apiKey,
		baseUrl,
	};
}
