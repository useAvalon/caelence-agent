import {
	errorResult,
	jsonResult,
	type McpToolDefinition,
	READ_ONLY_ANNOTATIONS,
} from "../core/mcp.ts";
import type { MemoryStore } from "../memory/memory-store.ts";

/**
 * Let the model look things up in memory mid-turn, and save a fact the user asked it to keep.
 * The facts recalled for the user's message are already in the system prompt; these cover a
 * question that only comes up later in the turn.
 */
export function createMemoryTools(
	store: MemoryStore,
	options: { sessionId?: () => string | undefined } = {},
): McpToolDefinition[] {
	return [
		{
			name: "memory_search",
			description:
				"Search facts remembered from earlier chats: the user's preferences, stack and tool choices, project decisions. " +
				"Use it when you need something that is not in this conversation.",
			annotations: READ_ONLY_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", description: "What to look for, in plain words." },
					limit: { type: "number", description: "How many facts to return (default 8, max 25)." },
				},
				required: ["query"],
			},
			async handler(raw) {
				const query = typeof raw.query === "string" ? raw.query.trim() : "";
				if (!query) return errorResult("query is empty");
				const limit =
					typeof raw.limit === "number" && Number.isFinite(raw.limit)
						? Math.min(Math.max(Math.floor(raw.limit), 1), 25)
						: 8;
				const facts = await store.search(query, limit);
				return jsonResult({
					query,
					facts: facts.map((fact) => ({ text: fact.text, scope: fact.scope })),
				});
			},
		},
		{
			name: "memory_save",
			description:
				"Remember one durable fact for later chats: a preference, a stack or tool choice, a project decision. " +
				"One short sentence. Never a secret, a key, or a detail of the current task only.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			inputSchema: {
				type: "object",
				properties: {
					text: { type: "string", description: "The fact, as one short sentence." },
					scope: {
						type: "string",
						enum: ["user", "project"],
						description: "user = about the person. project = about this project. Default project.",
					},
				},
				required: ["text"],
			},
			async handler(raw) {
				const text = typeof raw.text === "string" ? raw.text.trim() : "";
				if (!text) return errorResult("text is empty");
				try {
					const sessionId = options.sessionId?.();
					const added = await store.add([
						{
							text,
							scope: raw.scope === "user" ? "user" : "project",
							...(sessionId ? { sessionId } : {}),
						},
					]);
					return jsonResult({
						saved: added.length > 0,
						...(added.length === 0
							? { reason: "Already remembered, too short or long, or it looked like a secret." }
							: {}),
					});
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
	];
}
