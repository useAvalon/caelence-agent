/**
 * Vendor-neutral AI observability. Langfuse is one adapter; hosts may no-op.
 */

export interface SpanFields {
	input?: unknown;
	output?: unknown;
	metadata?: Record<string, unknown>;
	level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";
	statusMessage?: string;
}

export interface GenerationFields extends SpanFields {
	model?: string;
	usage?: {
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
	};
}

export interface SpanHandle {
	readonly traceId?: string;
	update(fields: SpanFields): void;
	end(): void;
}

export interface GenerationHandle extends SpanHandle {
	update(fields: GenerationFields): void;
}

export interface TurnOptions {
	name: string;
	input?: unknown;
	userId?: string;
	sessionId?: string;
	tags?: string[];
	metadata?: Record<string, unknown>;
}

export interface SpanOptions {
	input?: unknown;
	metadata?: Record<string, unknown>;
}

export interface GenerationOptions extends SpanOptions {
	model?: string;
}

export interface ScoreInput {
	name: string;
	value: number;
	comment?: string;
	traceId?: string;
	dataType?: "NUMERIC" | "BOOLEAN" | "CATEGORICAL";
	stringValue?: string;
	metadata?: Record<string, unknown>;
}

export interface EventInput {
	input?: unknown;
	metadata?: Record<string, unknown>;
}

/**
 * Thin observability seam. Implementations must never throw into the agent loop.
 */
export interface Observability {
	readonly enabled: boolean;
	startTurn<T>(options: TurnOptions, fn: (span: SpanHandle) => Promise<T>): Promise<T>;
	startSpan<T>(
		name: string,
		fn: (span: SpanHandle) => Promise<T>,
		options?: SpanOptions,
	): Promise<T>;
	generation<T>(
		name: string,
		fn: (span: GenerationHandle) => Promise<T>,
		options?: GenerationOptions,
	): Promise<T>;
	tool<T>(name: string, fn: (span: SpanHandle) => Promise<T>, options?: SpanOptions): Promise<T>;
	score(input: ScoreInput): void;
	event(name: string, input?: EventInput): void;
	currentTraceId(): string | undefined;
	flush(): Promise<void>;
	shutdown(): Promise<void>;
}

export interface CreateObservabilityOptions {
	/** Override auto-detect. `false` always no-ops. `true` still no-ops without keys. */
	enabled?: boolean;
	agentVersion?: string;
	environment?: string;
	env?: Record<string, string | undefined>;
}

export const FEEDBACK_CATEGORIES = [
	"design",
	"layout",
	"content",
	"code",
	"mobile",
	"didn't follow instructions",
	"other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FAILURE_CATEGORIES = [
	"PLANNING_ERROR",
	"CODE_GENERATION_ERROR",
	"BUILD_ERROR",
	"RUNTIME_ERROR",
	"DESIGN_ERROR",
	"RESPONSIVE_ERROR",
	"TOOL_ERROR",
	"MODEL_ERROR",
	"TIMEOUT",
	"USER_REQUIREMENT_MISMATCH",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];
