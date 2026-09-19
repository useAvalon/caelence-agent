/**
 * Remote MCP client (streamable HTTP): initialize, tools/list, tools/call
 * against a hosted vendor MCP with a vaulted bearer token.
 */

import {
	errorResult,
	jsonResult,
	type McpToolDefinition,
	resolveToolAnnotations,
	type ToolResult,
	textResult,
} from "../core/mcp.ts";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface RemoteMcpToolMeta {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations?: unknown;
}

export interface RemoteMcpClient {
	readonly mcpUrl: string;
	readonly sessionId: string | undefined;
	listTools(): Promise<RemoteMcpToolMeta[]>;
	callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

export interface LinkedMcpSource {
	connectorId: string;
	label: string;
	mcpUrl: string;
	accessToken: string;
}

function trimUnderscores(value: string): string {
	let trimmed = value;
	while (trimmed.startsWith("_")) trimmed = trimmed.slice(1);
	while (trimmed.endsWith("_")) trimmed = trimmed.slice(0, -1);
	return trimmed;
}

function slugToken(value: string, pattern: RegExp): string {
	return trimUnderscores(value.replace(pattern, "_"));
}

export function namespaceRemoteTool(connectorId: string, remoteName: string): string {
	const prefix = slugToken(connectorId, /[^a-zA-Z0-9]+/g);
	const tool = slugToken(remoteName, /\W+/g);
	return `${prefix}__${tool}`;
}

export async function openRemoteMcp(input: {
	mcpUrl: string;
	accessToken: string;
	clientName?: string;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}): Promise<RemoteMcpClient> {
	const fetchImpl = input.fetchImpl ?? globalThis.fetch;
	const mcpUrl = input.mcpUrl.trim();
	if (!mcpUrl) throw new Error("mcpUrl is required");
	const accessToken = input.accessToken.trim();

	let sessionId: string | undefined;
	let nextId = 1;

	const rpc = async (
		method: string,
		params?: Record<string, unknown>,
		opts?: { notification?: boolean },
	): Promise<unknown> => {
		const id = opts?.notification ? undefined : nextId++;
		const body: Record<string, unknown> = {
			jsonrpc: "2.0",
			method,
			...(params ? { params } : {}),
		};
		if (id !== undefined) body.id = id;

		const headers: Record<string, string> = {
			Accept: "application/json, text/event-stream",
			"Content-Type": "application/json",
			"MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
		};
		if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
		if (sessionId) headers["Mcp-Session-Id"] = sessionId;

		const res = await fetchImpl(mcpUrl, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: input.signal,
		});

		const returnedSession = res.headers.get("mcp-session-id") ?? res.headers.get("Mcp-Session-Id");
		if (returnedSession?.trim()) sessionId = returnedSession.trim();

		if (opts?.notification) {
			if (!res.ok && res.status !== 202 && res.status !== 204) {
				throw new Error(`MCP ${method} failed (${res.status})`);
			}
			return undefined;
		}

		const payload = await readMcpResponse(res);
		if (payload.error) {
			const msg =
				typeof payload.error === "object" &&
				payload.error &&
				"message" in payload.error &&
				typeof (payload.error as { message?: unknown }).message === "string"
					? (payload.error as { message: string }).message
					: `MCP ${method} error`;
			throw new Error(msg);
		}
		return payload.result;
	};

	await rpc("initialize", {
		protocolVersion: MCP_PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: { name: input.clientName ?? "caelence-agent", version: "0.1" },
	});
	await rpc("notifications/initialized", {}, { notification: true }).catch(() => undefined);

	return {
		mcpUrl,
		get sessionId() {
			return sessionId;
		},
		async listTools(): Promise<RemoteMcpToolMeta[]> {
			const result = await rpc("tools/list", {});
			const tools = (result as { tools?: unknown } | null)?.tools;
			if (!Array.isArray(tools)) return [];
			const out: RemoteMcpToolMeta[] = [];
			for (const raw of tools) {
				if (!raw || typeof raw !== "object") continue;
				const t = raw as Record<string, unknown>;
				const name = typeof t.name === "string" ? t.name.trim() : "";
				if (!name) continue;
				const description =
					typeof t.description === "string" && t.description.trim()
						? t.description.trim()
						: `Remote tool ${name}`;
				const inputSchema =
					t.inputSchema && typeof t.inputSchema === "object" && !Array.isArray(t.inputSchema)
						? (t.inputSchema as Record<string, unknown>)
						: { type: "object", properties: {} };
				out.push({ name, description, inputSchema, annotations: t.annotations });
			}
			return out;
		},
		async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
			try {
				const result = await rpc("tools/call", { name, arguments: args });
				return mapCallToolResult(result);
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};
}

export async function buildRemoteMcpTools(input: {
	sources: readonly LinkedMcpSource[];
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
	timeoutMs?: number;
	onWarn?: (message: string, data?: Record<string, unknown>) => void;
}): Promise<McpToolDefinition[]> {
	const timeoutMs = input.timeoutMs ?? 8_000;
	const out: McpToolDefinition[] = [];

	await Promise.all(
		input.sources.map(async (source) => {
			try {
				const tools = await withTimeout(
					(signal) =>
						loadSourceTools({
							source,
							fetchImpl: input.fetchImpl,
							signal,
						}),
					timeoutMs,
					input.signal,
				);
				out.push(...tools);
			} catch (err) {
				input.onWarn?.("remote MCP tools unavailable", {
					connectorId: source.connectorId,
					mcpUrl: source.mcpUrl,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}),
	);

	return out;
}

async function loadSourceTools(input: {
	source: LinkedMcpSource;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}): Promise<McpToolDefinition[]> {
	const client = await openRemoteMcp({
		mcpUrl: input.source.mcpUrl,
		accessToken: input.source.accessToken,
		fetchImpl: input.fetchImpl,
		signal: input.signal,
	});
	const remote = await client.listTools();
	return remote.map((tool) => {
		const name = namespaceRemoteTool(input.source.connectorId, tool.name);
		const schema = ensureObjectSchema(tool.inputSchema);
		return {
			name,
			description: `[${input.source.label}] ${tool.description}`,
			inputSchema: schema,
			annotations: resolveToolAnnotations(tool.annotations),
			async handler(raw: Record<string, unknown>): Promise<ToolResult> {
				const { projectId: _projectId, ...args } = raw;
				return client.callTool(tool.name, args);
			},
		};
	});
}

function ensureObjectSchema(schema: Record<string, unknown>): Record<string, unknown> {
	if (schema.type === "object" || schema.properties) return schema;
	return { type: "object", properties: {}, ...(schema as object) };
}

function scalarToolText(value: unknown): string | undefined {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return `${value}`;
	}
	return undefined;
}

function contentTexts(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	const textParts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as { type?: string; text?: string };
		if (b.type === "text" && typeof b.text === "string") textParts.push(b.text);
		else textParts.push(JSON.stringify(block));
	}
	return textParts;
}

function jsonObjectOrNull(text: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		/* plain text */
	}
	return null;
}

function mapCallToolResult(result: unknown): ToolResult {
	const scalar = scalarToolText(result);
	if (scalar !== undefined) return textResult(scalar);
	const r = result as {
		content?: unknown;
		isError?: boolean;
		structuredContent?: Record<string, unknown>;
	};
	const isError = r.isError === true;
	const textParts = contentTexts(r.content);
	if (textParts.length === 0 && r.structuredContent) {
		return jsonResult(r.structuredContent, isError);
	}
	if (textParts.length === 0) {
		return jsonResult(result as Record<string, unknown>, isError);
	}
	const text = textParts.join("\n");
	const parsed = jsonObjectOrNull(text);
	if (parsed) return jsonResult(parsed, isError);
	return textResult(text, isError);
}

async function readMcpResponse(res: Response): Promise<{
	result?: unknown;
	error?: unknown;
}> {
	const raw = await res.text();
	if (!res.ok) {
		throw new Error(`MCP HTTP ${res.status}: ${raw.slice(0, 240) || res.statusText}`);
	}
	const contentType = res.headers.get("content-type") ?? "";
	if (
		contentType.includes("text/event-stream") ||
		raw.startsWith("event:") ||
		raw.includes("\ndata:")
	) {
		const dataLines = raw
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.filter((line) => line.length > 0 && line !== "[DONE]");
		let last: { result?: unknown; error?: unknown } | null = null;
		for (const line of dataLines) {
			try {
				last = JSON.parse(line) as { result?: unknown; error?: unknown };
			} catch {
				/* keep scanning */
			}
		}
		if (!last) throw new Error("MCP SSE response had no data frames");
		return last;
	}
	if (!raw.trim()) return {};
	return JSON.parse(raw) as { result?: unknown; error?: unknown };
}

function withTimeout<T>(
	run: (signal: AbortSignal) => Promise<T>,
	ms: number,
	outer?: AbortSignal,
): Promise<T> {
	const ctrl = new AbortController();
	const onOuter = (): void => ctrl.abort();
	if (outer?.aborted) ctrl.abort();
	else outer?.addEventListener("abort", onOuter, { once: true });
	const timer = setTimeout(() => ctrl.abort(), ms);
	return run(ctrl.signal).finally(() => {
		clearTimeout(timer);
		outer?.removeEventListener("abort", onOuter);
	});
}
