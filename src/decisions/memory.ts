import { clipState, readNoulAnswer } from "./client.ts";
import { decide, type ResolvedDecisions } from "./config.ts";

/** Skip the extraction call only when Jev is quite sure there is nothing worth keeping. */
const SKIP_BELOW = 0.1;

/**
 * Memory extraction costs a full chat call after every turn. One cheap yes/no question tells
 * most turns apart from the few that hold a preference or project decision. Unsure, or any
 * failure, means extract as before, so a bad answer can only cost a call, never a memory.
 */
export async function turnHasDurableFact(
	decisions: ResolvedDecisions,
	source: string,
	signal?: AbortSignal,
): Promise<boolean> {
	if (!decisions.memory) return true;
	const json = await decide(
		decisions,
		{ turn: clipState(source, 3000) },
		{
			durable: {
				type: "noul",
				instructions:
					"Does this exchange state a lasting user preference, tool or stack choice, project decision, or convention worth remembering in later chats?",
				criteria: {
					true: "The user states how they like things done, picks a tool or approach, or records a decision that will still matter later.",
					false:
						"A one-off task, a question, a code change, an error, or small talk with nothing that outlasts this chat.",
				},
			},
		},
		signal,
	);
	const durable = readNoulAnswer(json, "durable");
	return durable === null || durable >= SKIP_BELOW;
}
