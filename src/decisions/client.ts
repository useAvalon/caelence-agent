import { OPENROUTER_DEFAULT_BASE_URL, stripTrailingSlashes } from "../config.ts";
import { PRODUCT_NAME } from "../product.ts";

/**
 * Client for the OpenRouter Decisions API (https://openrouter.ai/docs/guides/community/jev).
 * Decision models answer typed questions with probabilities and no text, so they cost far less
 * than a chat call. Every function here returns null instead of throwing: a decision that
 * cannot be made means "do what you did before", never "stop the turn".
 */

/** Pinned. Probabilities shift between releases, so thresholds are tuned per version. */
export const DEFAULT_JEV_MODEL = "typesafe/jev-1.14";

/** The endpoint is alpha, so keep the wait short. A slow decision is a missed shortcut. */
export const DECISIONS_TIMEOUT_MS = 4_000;

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ChoiceAnswerRaw {
	type?: string;
	choice?: string;
	confidence?: number;
	probabilities?: Record<string, number>;
}

export interface NoulAnswerRaw {
	type?: string;
	noul?: number;
}

export interface DecisionsResponse {
	answers?: Record<string, ChoiceAnswerRaw | NoulAnswerRaw>;
	usage?: { cost?: number; input_tokens?: number; output_tokens?: number };
}

export interface ChoiceAnswer {
	choice: string;
	confidence: number;
}

/** True only when the URL's hostname is openrouter.ai or one of its subdomains. */
function isOpenRouterHost(raw: string): boolean {
	try {
		const host = new URL(raw).hostname.toLowerCase();
		return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
	} catch {
		return false;
	}
}

/** `/api/alpha/decisions` lives beside `/api/v1`, not under it. */
export function decisionsUrl(baseUrl?: string): string {
	const raw = baseUrl?.trim() || OPENROUTER_DEFAULT_BASE_URL;
	if (isOpenRouterHost(raw)) return "https://openrouter.ai/api/alpha/decisions";
	const origin = stripTrailingSlashes(raw)
		.replace(/\/api\/v1$/, "")
		.replace(/\/v1$/, "");
	return `${origin}/api/alpha/decisions`;
}

export interface DecisionsRequest {
	apiKey: string;
	baseUrl?: string;
	model?: string;
	state: Record<string, unknown>;
	questions: Record<string, unknown>;
	timeoutMs?: number;
	signal?: AbortSignal;
	fetchImpl?: FetchImpl;
}

export async function submitDecisions(input: DecisionsRequest): Promise<DecisionsResponse | null> {
	if (!input.apiKey.trim()) return null;
	const fetchImpl = input.fetchImpl ?? globalThis.fetch;
	const timeout = AbortSignal.timeout(input.timeoutMs ?? DECISIONS_TIMEOUT_MS);
	const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
	try {
		const res = await fetchImpl(decisionsUrl(input.baseUrl), {
			method: "POST",
			signal,
			headers: {
				Authorization: `Bearer ${input.apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://caelence.com",
				"X-Title": PRODUCT_NAME,
			},
			body: JSON.stringify({
				model: input.model ?? DEFAULT_JEV_MODEL,
				state: input.state,
				questions: input.questions,
			}),
		});
		if (!res.ok) return null;
		const json = (await res.json()) as DecisionsResponse;
		return json && typeof json === "object" && json.answers ? json : null;
	} catch {
		return null;
	}
}

function choiceConfidence(answer: ChoiceAnswerRaw): number {
	if (typeof answer.confidence === "number") return answer.confidence;
	const probs = Object.values(answer.probabilities ?? {});
	return probs.length > 0 ? Math.max(...probs) : 0;
}

export function readChoiceAnswer(json: DecisionsResponse | null, key: string): ChoiceAnswer | null {
	const answer = json?.answers?.[key] as ChoiceAnswerRaw | undefined;
	if (!answer || typeof answer.choice !== "string" || !answer.choice) return null;
	return { choice: answer.choice, confidence: choiceConfidence(answer) };
}

/** Probability that the answer is yes, 0 to 1. */
export function readNoulAnswer(json: DecisionsResponse | null, key: string): number | null {
	const answer = json?.answers?.[key] as NoulAnswerRaw | undefined;
	return typeof answer?.noul === "number" ? answer.noul : null;
}

/** Shorten long strings in a state object so a decision never ships a whole file. */
export function clipState(value: unknown, maxString = 600, depth = 0): unknown {
	if (typeof value === "string") {
		return value.length > maxString
			? `${value.slice(0, maxString)}… [${value.length} chars]`
			: value;
	}
	if (depth >= 4 || value === null || typeof value !== "object") return value;
	if (Array.isArray(value))
		return value.slice(0, 20).map((v) => clipState(v, maxString, depth + 1));
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		out[key] = clipState(entry, maxString, depth + 1);
	}
	return out;
}
