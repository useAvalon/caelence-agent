import { AsyncLocalStorage } from "node:async_hooks";
import type {
	EventInput,
	GenerationFields,
	GenerationHandle,
	Observability,
	ScoreInput,
	SpanFields,
	SpanHandle,
	TurnOptions,
} from "./types.ts";

export interface RecordedSpan {
	kind: "turn" | "span" | "generation" | "tool" | "event";
	name: string;
	input?: unknown;
	output?: unknown;
	metadata?: Record<string, unknown>;
	model?: string;
	level?: string;
	statusMessage?: string;
	ended: boolean;
	children: RecordedSpan[];
}

export interface RecordedScore extends ScoreInput {
	traceId?: string;
}

interface Store {
	turn: RecordedSpan;
}

const als = new AsyncLocalStorage<Store>();

function applyFields(span: RecordedSpan, fields: SpanFields | GenerationFields): void {
	if ("input" in fields) span.input = fields.input;
	if ("output" in fields) span.output = fields.output;
	if (fields.metadata) span.metadata = { ...span.metadata, ...fields.metadata };
	if (fields.level) span.level = fields.level;
	if (fields.statusMessage) span.statusMessage = fields.statusMessage;
	if ("model" in fields && fields.model) span.model = fields.model;
}

function handleFor(span: RecordedSpan, traceId: string): GenerationHandle {
	return {
		get traceId() {
			return traceId;
		},
		update(fields) {
			applyFields(span, fields);
		},
		end() {
			span.ended = true;
		},
	};
}

function attach(child: RecordedSpan): void {
	const store = als.getStore();
	if (store) store.turn.children.push(child);
}

/**
 * In-memory observer for tests. Nested startSpan/tool/generation attach to the
 * active startTurn via AsyncLocalStorage.
 */
export function createRecordingObservability(): Observability & {
	turns: RecordedSpan[];
	scores: RecordedScore[];
	events: Array<{ name: string; input?: EventInput }>;
	traceId: string;
} {
	const turns: RecordedSpan[] = [];
	const scores: RecordedScore[] = [];
	const events: Array<{ name: string; input?: EventInput }> = [];
	const traceId = "trace_test";

	const runChild = async <T>(
		span: RecordedSpan,
		fn: (handle: SpanHandle) => Promise<T>,
	): Promise<T> => {
		attach(span);
		try {
			const result = await fn(handleFor(span, traceId));
			span.ended = true;
			return result;
		} catch (err) {
			span.ended = true;
			span.level = "ERROR";
			span.statusMessage = err instanceof Error ? err.message : String(err);
			throw err;
		}
	};

	return {
		enabled: true,
		turns,
		scores,
		events,
		traceId,
		async startTurn(options: TurnOptions, fn) {
			const span: RecordedSpan = {
				kind: "turn",
				name: options.name,
				input: options.input,
				metadata: {
					...options.metadata,
					...(options.sessionId ? { sessionId: options.sessionId } : {}),
					...(options.userId ? { userId: options.userId } : {}),
				},
				ended: false,
				children: [],
			};
			const parent = als.getStore();
			if (parent) parent.turn.children.push(span);
			else turns.push(span);
			return als.run({ turn: span }, async () => {
				try {
					const result = await fn(handleFor(span, traceId));
					span.ended = true;
					return result;
				} catch (err) {
					span.ended = true;
					span.level = "ERROR";
					span.statusMessage = err instanceof Error ? err.message : String(err);
					throw err;
				}
			});
		},
		startSpan(name, fn, options) {
			return runChild(
				{
					kind: "span",
					name,
					input: options?.input,
					metadata: options?.metadata,
					ended: false,
					children: [],
				},
				fn,
			);
		},
		generation(name, fn, options) {
			return runChild(
				{
					kind: "generation",
					name,
					input: options?.input,
					metadata: options?.metadata,
					model: options?.model,
					ended: false,
					children: [],
				},
				fn,
			);
		},
		tool(name, fn, options) {
			return runChild(
				{
					kind: "tool",
					name,
					input: options?.input,
					metadata: options?.metadata,
					ended: false,
					children: [],
				},
				fn,
			);
		},
		score(input) {
			scores.push({ ...input, traceId: input.traceId ?? (als.getStore() ? traceId : undefined) });
		},
		event(name, input) {
			events.push({ name, input });
			attach({
				kind: "event",
				name,
				input: input?.input,
				metadata: input?.metadata,
				ended: true,
				children: [],
			});
		},
		currentTraceId() {
			return als.getStore() ? traceId : undefined;
		},
		async flush() {},
		async shutdown() {},
	};
}
