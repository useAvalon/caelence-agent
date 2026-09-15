export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	costUsd?: number;
}

function asFinite(value: unknown): number | undefined {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isFinite(n) ? n : undefined;
}

export function parseTokenUsage(value: unknown): TokenUsage | undefined {
	if (!value || typeof value !== "object") return undefined;
	const rec = value as Record<string, unknown>;
	const usage =
		rec.usage && typeof rec.usage === "object" ? (rec.usage as Record<string, unknown>) : rec;
	const prompt = asFinite(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens);
	const completion = asFinite(
		usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens,
	);
	if (prompt === undefined && completion === undefined) return undefined;
	const total =
		asFinite(usage.total_tokens ?? usage.totalTokens) ?? (prompt ?? 0) + (completion ?? 0);
	const cost = asFinite(usage.cost ?? usage.total_cost ?? usage.costUsd);
	return {
		promptTokens: prompt ?? 0,
		completionTokens: completion ?? 0,
		totalTokens: total,
		...(cost !== undefined ? { costUsd: cost } : {}),
	};
}

export function addUsage(
	a: TokenUsage | undefined,
	b: TokenUsage | undefined,
): TokenUsage | undefined {
	if (!a) return b;
	if (!b) return a;
	const cost =
		a.costUsd !== undefined || b.costUsd !== undefined
			? (a.costUsd ?? 0) + (b.costUsd ?? 0)
			: undefined;
	return {
		promptTokens: a.promptTokens + b.promptTokens,
		completionTokens: a.completionTokens + b.completionTokens,
		totalTokens: a.totalTokens + b.totalTokens,
		...(cost !== undefined ? { costUsd: cost } : {}),
	};
}

export function formatUsage(usage: TokenUsage): string {
	const tokens = `${usage.promptTokens} in · ${usage.completionTokens} out`;
	if (usage.costUsd === undefined) return tokens;
	const cost = usage.costUsd < 0.01 ? usage.costUsd.toFixed(4) : usage.costUsd.toFixed(2);
	return `${tokens} · $${cost}`;
}

function stringDelta(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function reasoningFromDelta(delta: unknown): string | undefined {
	if (!delta || typeof delta !== "object") return undefined;
	const rec = delta as Record<string, unknown>;
	const direct = stringDelta(rec.reasoning) ?? stringDelta(rec.reasoning_content);
	if (direct) return direct;
	const details = rec.reasoning_details;
	if (!Array.isArray(details)) return undefined;
	const parts: string[] = [];
	for (const item of details) {
		if (!item || typeof item !== "object") continue;
		const row = item as Record<string, unknown>;
		if (typeof row.type === "string" && row.type.includes("encrypted")) continue;
		const text = stringDelta(row.text) ?? stringDelta(row.reasoning);
		if (text) parts.push(text);
	}
	return parts.length > 0 ? parts.join("") : undefined;
}

/** OpenRouter/OpenAI chat chunk → incremental reasoning, if the model sent any. */
export function reasoningTextFromChunk(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const rec = value as Record<string, unknown>;
	const choices = rec.choices;
	const choice = Array.isArray(choices) ? choices[0] : undefined;
	if (choice && typeof choice === "object") {
		const row = choice as Record<string, unknown>;
		return reasoningFromDelta(row.delta);
	}
	return reasoningFromDelta(rec.delta);
}

function scanSseLine(
	line: string,
	onUsage: (usage: TokenUsage) => void,
	onReasoning?: (text: string) => void,
): void {
	const trimmed = line.trim();
	if (!trimmed.startsWith("data:")) return;
	const raw = trimmed.slice(5).trim();
	if (!raw || raw === "[DONE]") return;
	try {
		const parsed = JSON.parse(raw) as unknown;
		const usage = parseTokenUsage(parsed);
		if (usage) onUsage(usage);
		const reasoning = reasoningTextFromChunk(parsed);
		if (reasoning) onReasoning?.(reasoning);
	} catch {
		// ignore partial SSE frames
	}
}

async function pumpSse(
	body: ReadableStream<Uint8Array>,
	onUsage: (usage: TokenUsage) => void,
	onReasoning?: (text: string) => void,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (value) buf += decoder.decode(value, { stream: !done });
			const parts = buf.split("\n");
			buf = done ? "" : (parts.pop() ?? "");
			for (const line of parts) scanSseLine(line, onUsage, onReasoning);
			if (done) {
				if (buf) scanSseLine(buf, onUsage, onReasoning);
				break;
			}
		}
	} catch {
		// probe side can fail independently of the model stream
	}
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Tee a fetch so streamed OpenRouter/OpenAI usage and reasoning are captured. */
export function createUsageTrackingFetch(
	onUsage: (usage: TokenUsage) => void,
	baseFetch: FetchFn = fetch,
	onReasoning?: (text: string) => void,
): FetchFn {
	return async (input, init) => {
		const res = await baseFetch(input, init);
		const contentType = res.headers.get("content-type") ?? "";
		if (!res.body) return res;
		if (contentType.includes("text/event-stream")) {
			const [out, probe] = res.body.tee();
			void pumpSse(probe, onUsage, onReasoning);
			return new Response(out, res);
		}
		if (contentType.includes("application/json")) {
			const text = await res.text();
			try {
				const parsed = JSON.parse(text) as unknown;
				const usage = parseTokenUsage(parsed);
				if (usage) onUsage(usage);
				const reasoning = reasoningTextFromChunk(parsed);
				if (reasoning) onReasoning?.(reasoning);
			} catch {
				// keep the body even if JSON is unexpected
			}
			return new Response(text, res);
		}
		return res;
	};
}
