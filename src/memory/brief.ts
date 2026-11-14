import type { MainModelProvider } from "../core/events.ts";
import type { MemoryFact } from "./store.ts";

export const DEFAULT_BRIEF_WORDS = 180;
/** Facts handed to the model for one brief. The newest are kept when there are more. */
export const MAX_BRIEF_FACTS = 200;

/**
 * The system prompt that turns a pile of remembered facts into one short brief. A brief is what
 * a new chat, or a new project in the same workspace, starts from.
 */
export function memoryBriefSystem(subject: string, maxWords = DEFAULT_BRIEF_WORDS): string {
	return [
		`Write a short brief of what is known about ${subject}, from the remembered facts below.`,
		"The facts are listed oldest first. When two disagree, the later one is right; leave the earlier one out.",
		"Group related points and say each thing once. Use plain sentences or short bullets.",
		"Use only what the facts say. Do not add advice, guesses, or anything they do not state.",
		`Stay under ${maxWords} words. Reply with the brief only, no heading and no preamble.`,
	].join(" ");
}

/**
 * Consolidate facts into a brief with one model call. Returns an empty string when there are no
 * facts or the model fails, so the caller keeps whatever brief it already had.
 */
export async function synthesizeMemoryBrief(input: {
	facts: readonly MemoryFact[];
	provider: MainModelProvider;
	/** What the facts are about: "this project", "the Acme workspace". */
	subject: string;
	maxWords?: number;
	signal?: AbortSignal;
}): Promise<string> {
	const facts = input.facts.slice(-MAX_BRIEF_FACTS);
	if (facts.length === 0) return "";
	const maxWords = input.maxWords ?? DEFAULT_BRIEF_WORDS;
	let raw = "";
	for await (const event of input.provider.stream(
		{
			system: memoryBriefSystem(input.subject, maxWords),
			messages: [{ role: "user", content: facts.map((fact) => `- ${fact.text}`).join("\n") }],
			maxTokens: Math.ceil(maxWords * 2.5),
		},
		input.signal ? { signal: input.signal } : undefined,
	)) {
		if (event.type === "text_delta") raw += event.text;
		if (event.type === "error") return "";
	}
	const words = raw.trim().split(/\s+/).filter(Boolean);
	// A model that ignores the limit is cut rather than trusted with the whole prompt budget.
	if (words.length > maxWords * 1.5)
		return `${words.slice(0, Math.floor(maxWords * 1.5)).join(" ")} …`;
	return raw.trim();
}

/** The briefs as system-prompt sections, widest first so the narrower one has the last word. */
export function formatMemoryBriefs(briefs: ReadonlyArray<{ title: string; text: string }>): string {
	return briefs
		.filter((brief) => brief.text.trim())
		.map((brief) => `### ${brief.title}\n${brief.text.trim()}`)
		.join("\n\n");
}
