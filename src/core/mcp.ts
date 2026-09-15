/**
 * Minimal MCP tool registry + newline-delimited JSON-RPC stdio loop.
 */

export interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
}

export interface McpToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	handler(input: Record<string, unknown>): Promise<ToolResult>;
}

export interface McpToolSet {
	readonly tools: readonly McpToolDefinition[];
}

export interface McpServer extends McpToolSet {
	listTools(): McpToolDefinition[];
	callTool(name: string, input: Record<string, unknown>): Promise<ToolResult>;
}

export function textResult(text: string, isError = false): ToolResult {
	return { content: [{ type: "text", text }], isError };
}

export function jsonResult(value: unknown, isError = false): ToolResult {
	const text = JSON.stringify(value, null, 2);
	const structured =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	return {
		content: [{ type: "text", text }],
		isError,
		...(structured ? { structuredContent: structured } : {}),
	};
}

export function errorResult(message: string): ToolResult {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
		structuredContent: { error: message },
	};
}

export function createMcpServer(tools: McpToolDefinition[]): McpServer {
	const byName = new Map(tools.map((t) => [t.name, t]));
	return {
		tools,
		listTools() {
			return [...tools];
		},
		async callTool(name, input) {
			const tool = byName.get(name);
			if (tool === undefined) {
				return errorResult(`Unknown tool: ${JSON.stringify(name)}`);
			}
			return tool.handler(input ?? {});
		},
	};
}

export function toolResultText(result: ToolResult): string {
	return result.content.map((block) => block.text).join("\n");
}

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: JsonRpcId;
	method: string;
	params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2024-11-05";

export interface StdioServerOptions {
	name: string;
	version?: string;
	onError?: (message: string) => void;
}

export function runStdioMcpServer(server: McpServer, options: StdioServerOptions): Promise<void> {
	const onError = options.onError ?? ((m: string) => process.stderr.write(`${m}\n`));

	const write = (message: Record<string, unknown>): void => {
		process.stdout.write(`${JSON.stringify(message)}\n`);
	};

	const handle = async (line: string): Promise<void> => {
		const trimmed = line.trim();
		if (trimmed === "") return;
		let req: JsonRpcRequest;
		try {
			req = JSON.parse(trimmed) as JsonRpcRequest;
		} catch {
			write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
			return;
		}
		const isNotification = req.id === undefined;
		try {
			const result = await dispatch(server, req, options);
			if (!isNotification) write({ jsonrpc: "2.0", id: req.id ?? null, result });
		} catch (err) {
			if (!isNotification) {
				const code = err instanceof JsonRpcMethodError ? -32601 : -32603;
				write({
					jsonrpc: "2.0",
					id: req.id ?? null,
					error: { code, message: err instanceof Error ? err.message : String(err) },
				});
			}
		}
	};

	return new Promise<void>((resolve) => {
		let buffer = "";
		let chain: Promise<void> = Promise.resolve();
		const stdin = process.stdin;
		stdin.setEncoding("utf8");
		stdin.on("data", (chunk: string) => {
			buffer += chunk;
			let idx = buffer.indexOf("\n");
			while (idx >= 0) {
				const line = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 1);
				chain = chain.then(() => handle(line)).catch((err) => onError(String(err)));
				idx = buffer.indexOf("\n");
			}
		});
		stdin.on("end", () => {
			chain = chain
				.then(() => (buffer.trim() === "" ? undefined : handle(buffer)))
				.then(() => resolve())
				.catch((err) => {
					onError(String(err));
					resolve();
				});
		});
		stdin.on("error", (err: unknown) => {
			onError(String(err));
			resolve();
		});
	});
}

async function dispatch(
	server: McpServer,
	req: JsonRpcRequest,
	options: StdioServerOptions,
): Promise<Record<string, unknown>> {
	switch (req.method) {
		case "initialize":
			return {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: options.name, version: options.version ?? "0.0.0" },
			};
		case "notifications/initialized":
			return {};
		case "tools/list":
			return {
				tools: server.listTools().map((t) => ({
					name: t.name,
					description: t.description,
					inputSchema: t.inputSchema,
				})),
			};
		case "tools/call": {
			const params = req.params ?? {};
			const name = typeof params.name === "string" ? params.name : "";
			const args =
				params.arguments && typeof params.arguments === "object"
					? (params.arguments as Record<string, unknown>)
					: {};
			const result = await server.callTool(name, args);
			return result as unknown as Record<string, unknown>;
		}
		default:
			throw new JsonRpcMethodError(`Method not found: ${req.method}`);
	}
}

class JsonRpcMethodError extends Error {}
