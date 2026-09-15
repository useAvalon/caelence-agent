import { type Subprocess, spawn } from "bun";
import {
	errorResult,
	jsonResult,
	type McpToolDefinition,
	type ToolResult,
	textResult,
} from "./mcp.ts";

interface JsonRpcResponse {
	jsonrpc?: string;
	id?: number | string | null;
	result?: unknown;
	error?: { code?: number; message?: string };
}

export interface StdioMcpClientOptions {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

/**
 * Spawn an extra MCP server over newline JSON-RPC and expose its tools
 * as in-process {@link McpToolDefinition}s.
 */
export async function loadStdioMcpTools(
	options: StdioMcpClientOptions,
): Promise<{ tools: McpToolDefinition[]; close: () => void }> {
	const proc: Subprocess = spawn({
		cmd: [options.command, ...(options.args ?? [])],
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	let nextId = 1;
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	let buffer = "";
	let closed = false;

	const failAll = (err: Error): void => {
		for (const p of pending.values()) p.reject(err);
		pending.clear();
	};

	const onLine = (line: string): void => {
		const trimmed = line.trim();
		if (!trimmed) return;
		let msg: JsonRpcResponse;
		try {
			msg = JSON.parse(trimmed) as JsonRpcResponse;
		} catch {
			return;
		}
		if (typeof msg.id !== "number") return;
		const waiter = pending.get(msg.id);
		if (!waiter) return;
		pending.delete(msg.id);
		if (msg.error) waiter.reject(new Error(msg.error.message ?? "MCP error"));
		else waiter.resolve(msg.result);
	};

	const stdout = proc.stdout;
	if (stdout && typeof stdout !== "number") {
		(async () => {
			const reader = stdout.getReader();
			const decoder = new TextDecoder();
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					let idx = buffer.indexOf("\n");
					while (idx >= 0) {
						onLine(buffer.slice(0, idx));
						buffer = buffer.slice(idx + 1);
						idx = buffer.indexOf("\n");
					}
				}
			} catch (err) {
				failAll(err instanceof Error ? err : new Error(String(err)));
			}
		})();
	}

	const rpc = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
		if (closed) return Promise.reject(new Error("MCP process closed"));
		const id = nextId++;
		const payload = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
		const stdin = proc.stdin;
		if (!stdin || typeof stdin === "number") return Promise.reject(new Error("MCP stdin closed"));
		stdin.write(`${payload}\n`);
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
		});
	};

	const close = (): void => {
		closed = true;
		failAll(new Error("MCP process closed"));
		try {
			proc.kill();
		} catch {
			// already gone
		}
	};

	await rpc("initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "caelence-harness", version: "0.1.0" },
	});
	await rpc("notifications/initialized").catch(() => undefined);

	const listed = (await rpc("tools/list")) as {
		tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
	};
	const remote = listed.tools ?? [];
	const prefix = options.command.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "mcp";

	const tools: McpToolDefinition[] = remote.map((t) => ({
		name: `${prefix}__${t.name}`,
		description: t.description ?? t.name,
		inputSchema: t.inputSchema ?? { type: "object", properties: {} },
		async handler(input) {
			try {
				const result = (await rpc("tools/call", { name: t.name, arguments: input })) as ToolResult;
				if (result && Array.isArray(result.content)) return result;
				if (result && typeof result === "object")
					return jsonResult(result as unknown as Record<string, unknown>);
				return textResult(String(result ?? ""));
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	}));

	return { tools, close };
}
