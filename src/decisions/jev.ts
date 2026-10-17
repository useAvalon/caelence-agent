import { DEFAULT_MODELS, type ModelRole, titleForRole } from "../cli/defaults.ts";
import { openRouterDecisionsUrl } from "./openrouter-url.ts";

export const JEV_MODEL = DEFAULT_MODELS.router;

export type JevRoute = "agent" | "open_url" | "open_search" | "open_app";

export interface JevRoutePlan {
	route: JevRoute;
	confidence: number;
}

export interface JevChoiceAnswer {
	choice: string;
	confidence: number;
}

export interface JevNoulAnswer {
	probability: number;
}

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ChoiceAnswerRaw {
	type?: string;
	choice?: string;
	confidence?: number;
	probabilities?: Record<string, number>;
}

interface NoulAnswerRaw {
	type?: string;
	noul?: number;
}

interface DecisionsResponse {
	answers?: Record<string, ChoiceAnswerRaw | NoulAnswerRaw>;
	error?: { message?: string };
}

function authHeaders(apiKey: string, role: ModelRole = "router"): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		"HTTP-Referer": "https://caelence.com",
		"X-Title": titleForRole(role),
	};
}

function choiceConfidence(answer: ChoiceAnswerRaw | undefined): number {
	if (!answer) return 0;
	if (typeof answer.confidence === "number") return answer.confidence;
	const probs = Object.values(answer.probabilities ?? {});
	return probs.length > 0 ? Math.max(...probs) : 0;
}

export async function submitJevDecisions(input: {
	apiKey: string;
	baseUrl?: string;
	model?: string;
	role?: ModelRole;
	state: Record<string, unknown>;
	questions: Record<string, unknown>;
	fetchImpl?: FetchImpl;
}): Promise<DecisionsResponse | null> {
	if (!input.apiKey.trim()) return null;
	const fetchImpl = input.fetchImpl ?? globalThis.fetch;
	const res = await fetchImpl(openRouterDecisionsUrl(input.baseUrl), {
		method: "POST",
		headers: authHeaders(input.apiKey, input.role ?? "router"),
		body: JSON.stringify({
			model: input.model ?? JEV_MODEL,
			state: input.state,
			questions: input.questions,
		}),
	});
	if (!res.ok) return null;
	return (await res.json()) as DecisionsResponse;
}

export function readChoiceAnswer(
	json: DecisionsResponse | null,
	key: string,
): JevChoiceAnswer | null {
	const answer = json?.answers?.[key] as ChoiceAnswerRaw | undefined;
	const choice = answer?.choice;
	if (!choice) return null;
	return { choice, confidence: choiceConfidence(answer) };
}

export function readNoulAnswer(json: DecisionsResponse | null, key: string): JevNoulAnswer | null {
	const answer = json?.answers?.[key] as NoulAnswerRaw | undefined;
	if (typeof answer?.noul !== "number") return null;
	return { probability: answer.noul };
}

/** Classify whether a user message is a direct screen action or needs the full agent. */
export async function classifyAgentRoute(input: {
	message: string;
	apiKey: string;
	baseUrl?: string;
	model?: string;
	minConfidence?: number;
	fetchImpl?: FetchImpl;
}): Promise<JevRoutePlan | null> {
	const message = input.message.trim();
	if (!message || message.startsWith("/")) return null;

	const json = await submitJevDecisions({
		apiKey: input.apiKey,
		baseUrl: input.baseUrl,
		model: input.model,
		fetchImpl: input.fetchImpl,
		state: { user_message: message },
		questions: {
			route: {
				type: "choice",
				instructions: "How should Caelence respond to this user message?",
				criteria: {
					agent:
						"Questions to answer, research, explanations, coding, files, or any task that needs reasoning or tools beyond only opening a browser tab.",
					open_url:
						"User wants a specific website or URL opened in the browser — not a question to answer.",
					open_search:
						"User explicitly asks to google something or open a web search results page — not a general question they want answered in chat.",
					open_app: "User wants a desktop application opened by name (Safari, Mail, Notes, etc.).",
				},
			},
		},
	});
	const picked = readChoiceAnswer(json, "route");
	const route = picked?.choice;
	if (
		route !== "agent" &&
		route !== "open_url" &&
		route !== "open_search" &&
		route !== "open_app"
	) {
		return null;
	}
	const min = input.minConfidence ?? 0.55;
	if (!picked || picked.confidence < min) return null;
	return { route, confidence: picked.confidence };
}

/** @deprecated Use {@link classifyAgentRoute}. */
export const classifyBerryRoute = classifyAgentRoute;
