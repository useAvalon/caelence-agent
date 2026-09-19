import { describe, expect, test } from "bun:test";
import {
	createMcpServer,
	mcpToolListItem,
	READ_ONLY_ANNOTATIONS,
	resolveToolAnnotations,
	UNKNOWN_TOOL_ANNOTATIONS,
} from "./mcp.ts";

describe("tool annotations", () => {
	test("requires all four hints or falls back", () => {
		expect(resolveToolAnnotations(undefined)).toEqual(UNKNOWN_TOOL_ANNOTATIONS);
		expect(resolveToolAnnotations({ readOnlyHint: true })).toEqual(UNKNOWN_TOOL_ANNOTATIONS);
		expect(resolveToolAnnotations(READ_ONLY_ANNOTATIONS)).toEqual(READ_ONLY_ANNOTATIONS);
	});

	test("tools/list payload includes explicit boolean hints", () => {
		const listed = mcpToolListItem({
			name: "git_status",
			description: "status",
			inputSchema: { type: "object", properties: {} },
			annotations: READ_ONLY_ANNOTATIONS,
			async handler() {
				return { content: [{ type: "text", text: "ok" }] };
			},
		});
		expect(listed.annotations).toEqual({
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		});
		const server = createMcpServer([
			{
				name: "git_status",
				description: "status",
				inputSchema: { type: "object", properties: {} },
				annotations: READ_ONLY_ANNOTATIONS,
				async handler() {
					return { content: [{ type: "text", text: "ok" }] };
				},
			},
		]);
		expect(server.listTools()[0]?.annotations.readOnlyHint).toBe(true);
	});
});
