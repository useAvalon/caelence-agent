/** OpenRouter `reasoning.effort` values. */
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";

export const REASONING_EFFORT_USAGE = "Effort is none, minimal, low, medium, high, or xhigh.";

export function tryParseReasoningEffort(raw: string | undefined): ReasoningEffort | undefined {
	const value = raw?.trim().toLowerCase();
	return (REASONING_EFFORTS as readonly string[]).includes(value ?? "")
		? (value as ReasoningEffort)
		: undefined;
}

export function parseReasoningEffort(raw: string | undefined): ReasoningEffort {
	return tryParseReasoningEffort(raw) ?? DEFAULT_REASONING_EFFORT;
}

export function resolveReasoningEffort(input: {
	option?: string;
	config?: string;
	env?: Record<string, string | undefined>;
}): ReasoningEffort {
	const env = input.env ?? process.env;
	return (
		tryParseReasoningEffort(input.option) ??
		tryParseReasoningEffort(env.HARNESS_REASONING_EFFORT) ??
		tryParseReasoningEffort(input.config) ??
		DEFAULT_REASONING_EFFORT
	);
}
