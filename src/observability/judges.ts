import type { Observability } from "./types.ts";

export const QUALITY_DIMENSIONS = [
	"instruction_following",
	"visual_quality",
	"content_quality",
	"design_consistency",
	"ux_quality",
	"code_quality",
] as const;

export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];

export interface QualityScores {
	[name: string]: number;
}

const JUDGE_SYSTEM = `You score a generated website against the user's request.
Reply with JSON only: an object whose keys are exactly
instruction_following, visual_quality, content_quality, design_consistency, ux_quality, code_quality
and whose values are numbers from 0 to 1.
Do not invent metrics about the business. Score only what you can see in the provided artifacts.`;

export function parseQualityScores(text: string): QualityScores | undefined {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
		const out: QualityScores = {};
		for (const key of QUALITY_DIMENSIONS) {
			const raw = parsed[key];
			const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
			if (!Number.isFinite(n)) continue;
			out[key] = Math.min(1, Math.max(0, n));
		}
		return Object.keys(out).length > 0 ? out : undefined;
	} catch {
		return undefined;
	}
}

export async function scoreQualityDimensions(input: {
	obs: Observability;
	chat: (args: { system: string; user: string; model: string }) => Promise<string>;
	model: string;
	userRequest: string;
	artifact: string;
	traceId?: string;
}): Promise<QualityScores | undefined> {
	if (!input.obs.enabled) return undefined;
	try {
		const text = await input.chat({
			system: JUDGE_SYSTEM,
			user: `Request:\n${input.userRequest.slice(0, 4000)}\n\nArtifact:\n${input.artifact.slice(0, 12_000)}`,
			model: input.model,
		});
		const scores = parseQualityScores(text);
		if (!scores) return undefined;
		for (const [name, value] of Object.entries(scores)) {
			input.obs.score({
				name,
				value,
				traceId: input.traceId,
				dataType: "NUMERIC",
			});
		}
		return scores;
	} catch {
		return undefined;
	}
}

/** Opt-in LLM-as-judge. Off unless `LANGFUSE_QUALITY_EVAL` is 1/true/yes. */
export function qualityEvalEnabled(env: Record<string, string | undefined> = process.env): boolean {
	const value = (env.LANGFUSE_QUALITY_EVAL ?? "").trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

/** Deterministic scores from scans (site-design eval, health checks). Never invent. */
export function postDeterministicScores(
	obs: Observability,
	scores: Record<string, number>,
	traceId?: string,
): void {
	if (!obs.enabled) return;
	for (const [name, value] of Object.entries(scores)) {
		if (!Number.isFinite(value)) continue;
		obs.score({ name, value, traceId, dataType: "NUMERIC" });
	}
}
