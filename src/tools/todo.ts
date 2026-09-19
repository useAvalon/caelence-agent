import { jsonResult, type McpToolDefinition } from "../core/mcp.ts";

export const TODO_STATUSES = ["pending", "in_progress", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
	id: string;
	content: string;
	status: TodoStatus;
}

export interface TodoStore {
	list(): TodoItem[];
	replace(items: TodoItem[]): TodoItem[];
}

export function createMemoryTodoStore(): TodoStore {
	let items: TodoItem[] = [];
	return {
		list: () => items.map((item) => ({ ...item })),
		replace(next) {
			items = next.map((item) => ({ ...item }));
			return items.map((item) => ({ ...item }));
		},
	};
}

function asStatus(value: unknown): TodoStatus | undefined {
	return value === "pending" || value === "in_progress" || value === "done" ? value : undefined;
}

export function createTodoTool(store: TodoStore): McpToolDefinition {
	return {
		name: "todo_write",
		description:
			"Replace the session todo list. Use for multi-step work. One in_progress item at a time.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true,
			openWorldHint: false,
		},
		inputSchema: {
			type: "object",
			properties: {
				items: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							content: { type: "string" },
							status: { type: "string", enum: [...TODO_STATUSES] },
						},
						required: ["id", "content", "status"],
					},
				},
			},
			required: ["items"],
		},
		async handler(raw) {
			const rawItems = Array.isArray(raw.items) ? raw.items : [];
			const items: TodoItem[] = [];
			for (const entry of rawItems) {
				if (!entry || typeof entry !== "object") continue;
				const rec = entry as Record<string, unknown>;
				const id = typeof rec.id === "string" ? rec.id.trim() : "";
				const content = typeof rec.content === "string" ? rec.content.trim() : "";
				const status = asStatus(rec.status);
				if (!id || !content || !status) continue;
				items.push({ id, content, status });
			}
			return jsonResult({ items: store.replace(items) });
		},
	};
}
