import { describe, expect, test } from "bun:test";
import { createMemoryTodoStore, createTodoTool } from "./todo.ts";

describe("todo_write", () => {
	test("replaces the list and drops invalid items", async () => {
		const store = createMemoryTodoStore();
		const tool = createTodoTool(store);
		const result = await tool.handler({
			items: [
				{ id: "1", content: "inspect", status: "done" },
				{ id: "2", content: "edit", status: "in_progress" },
				{ id: "", content: "skip", status: "pending" },
				{ id: "3", content: "later", status: "nope" },
			],
		});
		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({
			items: [
				{ id: "1", content: "inspect", status: "done" },
				{ id: "2", content: "edit", status: "in_progress" },
			],
		});
		expect(store.list()).toHaveLength(2);
	});
});
