import type { MainModelProvider } from "../core/events.ts";
import type { Session } from "../core/session.ts";
import { addFacts, type MemoryScope } from "./store.ts";

export const MEMORY_EXTRACT_SYSTEM = [
	"Extract durable facts worth remembering in later chats with this coding agent.",
	"Keep: user preferences, stack and tool choices, project decisions, stable conventions.",
	"Write each pref as a short factual sentence the user might ask about later.",
	"Drop: secrets, keys, one-off task details, file contents, compliments, transient errors, anything already obvious from the repo.",
	'Reply with a JSON array only. Each item is {"text":"short sentence","scope":"user"|"project"}.',
	"scope is user for personal style or prefs, project for this repository.",
	"If nothing is durable, reply [].",
].join(" ");

export interface ExtractedFact {
	text: string;
	scope: MemoryScope;
}

export function parseExtractedFacts(raw: string): ExtractedFact[] {
	const text = raw.trim();
	if (!text) return [];
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start < 0 || end <= start) return [];
	try {
		const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
		if (!Array.isArray(parsed)) return [];
		const out: ExtractedFact[] = [];
		for (const item of parsed) {
			if (!item || typeof item !== "object") continue;
			const row = item as { text?: unknown; scope?: unknown };
			if (typeof row.text !== "string") continue;
			out.push({
				text: row.text,
				scope: row.scope === "user" ? "user" : "project",
			});
		}
		return out;
	} catch {
		return [];
	}
}

export function turnMemorySource(session: Session): string {
	let user = "";
	let assistant = "";
	const tools: string[] = [];
	for (const message of session.messages) {
		if (message.kind === "turn" && message.role === "user") user = message.content;
		if (message.kind === "turn" && message.role === "assistant") assistant = message.content;
		if (message.kind === "tool" && message.status === "ok" && message.preview) {
			tools.push(`${message.name}: ${message.preview}`);
		}
	}
	if (!user.trim() && !assistant.trim()) return "";
	const clip = (value: string) => (value.length > 4000 ? `${value.slice(0, 4000)}\n…` : value);
	const parts = [`User:\n${clip(user)}`, `Assistant:\n${clip(assistant)}`];
	if (tools.length > 0) parts.push(`Tools:\n${clip(tools.slice(-6).join("\n"))}`);
	return parts.join("\n\n");
}

export async function extractMemories(input: {
	cwd: string;
	session: Session;
	provider: MainModelProvider;
	env?: Record<string, string | undefined>;
}): Promise<number> {
	const source = turnMemorySource(input.session);
	if (!source.trim()) return 0;
	let raw = "";
	for await (const event of input.provider.stream({
		system: MEMORY_EXTRACT_SYSTEM,
		messages: [{ role: "user", content: source }],
		maxTokens: 300,
	})) {
		if (event.type === "text_delta") raw += event.text;
		if (event.type === "error") return 0;
	}
	return addFacts(
		input.cwd,
		parseExtractedFacts(raw).map((fact) => ({
			...fact,
			sessionId: input.session.id,
		})),
		input.env,
	).length;
}
