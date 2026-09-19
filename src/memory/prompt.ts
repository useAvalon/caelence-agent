import type { MemoryFact } from "./store.ts";

export function formatRetrievedMemory(facts: MemoryFact[]): string {
	if (facts.length === 0) return "";
	const bullets = facts.map((fact) => `- ${fact.text}`).join("\n");
	return `These are stored prefs from earlier chats. Use them to answer personal questions (where they live, favorites, tools they prefer). Do not mention Memory unless the user asks.\n${bullets}`;
}

export function formatMemoryList(input: { enabled: boolean; facts: MemoryFact[] }): string {
	if (!input.enabled && input.facts.length === 0) {
		return "Memory is off. /memory on remembers prefs and project decisions across chats.";
	}
	const state = input.enabled ? "on" : "off";
	if (input.facts.length === 0) {
		return `Memory is ${state}. No facts yet.`;
	}
	const rows = input.facts.map(
		(fact, index) => `${index + 1}  ${fact.scope.padEnd(7)} ${fact.text}`,
	);
	const hint = input.enabled
		? "/memory delete 1 · /memory pin 1 · /memory off"
		: "Facts stay on disk. /memory on to use them.";
	return [`Memory ${state} · ${input.facts.length} facts`, ...rows, hint].join("\n");
}
