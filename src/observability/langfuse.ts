import { sanitize } from "./sanitize.ts";
import type {
	CreateObservabilityOptions,
	EventInput,
	GenerationHandle,
	Observability,
	ScoreInput,
	SpanHandle,
	TurnOptions,
} from "./types.ts";
import { resolveAgentVersion, resolveEnvironment } from "./version.ts";

type StartActive = (
	name: string,
	fn: (obs: LangfuseObservation) => Promise<unknown>,
	options?: { asType?: string },
) => Promise<unknown>;

interface LangfuseObservation {
	update(fields: Record<string, unknown>): unknown;
	end?(): void;
}

interface LangfuseTracing {
	startActiveObservation: StartActive;
	propagateAttributes: (
		attrs: Record<string, unknown>,
		fn: () => Promise<unknown>,
	) => Promise<unknown>;
	getActiveTraceId?: () => string | undefined;
}

interface LangfuseClientLike {
	score: {
		create(input: Record<string, unknown>): Promise<unknown>;
	};
	flush?: () => Promise<unknown>;
	shutdown?: () => Promise<unknown>;
}

interface OtelHandle {
	shutdown(): Promise<void>;
}

function safe(fn: () => void): void {
	try {
		fn();
	} catch {
		// never throw into the agent loop
	}
}

function observationHandle(
	obs: LangfuseObservation,
	getTraceId: () => string | undefined,
): GenerationHandle {
	return {
		get traceId() {
			return getTraceId();
		},
		update(fields) {
			safe(() => {
				const payload: Record<string, unknown> = {};
				if ("input" in fields) payload.input = sanitize(fields.input);
				if ("output" in fields) payload.output = sanitize(fields.output);
				if (fields.metadata) payload.metadata = sanitize(fields.metadata);
				if (fields.level) payload.level = fields.level;
				if (fields.statusMessage) payload.statusMessage = fields.statusMessage;
				if ("model" in fields && fields.model) payload.model = fields.model;
				if ("usage" in fields && fields.usage) {
					payload.usageDetails = {
						promptTokens: fields.usage.promptTokens,
						completionTokens: fields.usage.completionTokens,
						totalTokens: fields.usage.totalTokens,
					};
				}
				obs.update(payload);
			});
		},
		end() {
			safe(() => {
				obs.end?.();
			});
		},
	};
}

export async function tryCreateLangfuseObservability(
	options: CreateObservabilityOptions = {},
): Promise<Observability | undefined> {
	const env = options.env ?? process.env;
	const secret = env.LANGFUSE_SECRET_KEY?.trim();
	const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
	if (!secret || !publicKey) return undefined;

	let tracing: LangfuseTracing;
	let LangfuseSpanProcessor: new (opts?: Record<string, unknown>) => unknown;
	let NodeSDK: new (opts: {
		spanProcessors: unknown[];
	}) => { start(): void; shutdown(): Promise<void> };
	let LangfuseClient: new (opts?: Record<string, unknown>) => LangfuseClientLike;
	try {
		const tracingMod = (await import("@langfuse/tracing")) as unknown as LangfuseTracing;
		const otelMod = (await import("@langfuse/otel")) as {
			LangfuseSpanProcessor: typeof LangfuseSpanProcessor;
		};
		const sdkMod = (await import("@opentelemetry/sdk-node")) as { NodeSDK: typeof NodeSDK };
		const clientMod = (await import("@langfuse/client")) as unknown as {
			LangfuseClient: typeof LangfuseClient;
		};
		tracing = tracingMod;
		LangfuseSpanProcessor = otelMod.LangfuseSpanProcessor;
		NodeSDK = sdkMod.NodeSDK;
		LangfuseClient = clientMod.LangfuseClient;
	} catch {
		return undefined;
	}

	const baseUrl = env.LANGFUSE_BASE_URL?.trim() || undefined;
	const agentVersion = resolveAgentVersion(options.agentVersion, env);
	const environment = options.environment ?? resolveEnvironment(env);

	let otel: OtelHandle | undefined;
	try {
		const processor = new LangfuseSpanProcessor({
			publicKey,
			secretKey: secret,
			...(baseUrl ? { baseUrl } : {}),
			environment,
		});
		const sdk = new NodeSDK({ spanProcessors: [processor] });
		sdk.start();
		otel = sdk;
	} catch {
		return undefined;
	}

	const client = new LangfuseClient({
		publicKey,
		secretKey: secret,
		...(baseUrl ? { baseUrl } : {}),
	});

	const getTraceId = (): string | undefined => {
		try {
			return tracing.getActiveTraceId?.();
		} catch {
			return undefined;
		}
	};

	const runObservation = async <T>(
		name: string,
		asType: string,
		fn: (span: SpanHandle) => Promise<T>,
		seed?: Record<string, unknown>,
	): Promise<T> => {
		try {
			return (await tracing.startActiveObservation(
				name,
				async (obs) => {
					if (seed && Object.keys(seed).length > 0) {
						safe(() => obs.update(seed));
					}
					return fn(observationHandle(obs, getTraceId));
				},
				{ asType },
			)) as T;
		} catch (err) {
			// If Langfuse itself fails, still run the work.
			if (err instanceof Error && /langfuse/i.test(err.message)) {
				return fn(observationHandle({ update() {}, end() {} }, getTraceId));
			}
			throw err;
		}
	};

	const obs: Observability = {
		enabled: true,
		async startTurn(turn: TurnOptions, fn) {
			const metadata = sanitize({
				...turn.metadata,
				agentVersion,
				environment,
				...(turn.sessionId ? { sessionId: turn.sessionId } : {}),
			});
			const attrs: Record<string, unknown> = {
				traceName: turn.name,
				metadata,
				version: agentVersion,
			};
			if (turn.userId) attrs.userId = turn.userId;
			if (turn.sessionId) attrs.sessionId = turn.sessionId;
			if (turn.tags) attrs.tags = turn.tags;
			try {
				return (await tracing.propagateAttributes(attrs, () =>
					runObservation(
						turn.name,
						"span",
						fn,
						turn.input !== undefined ? { input: sanitize(turn.input) } : undefined,
					),
				)) as Awaited<ReturnType<typeof fn>>;
			} catch {
				return fn(observationHandle({ update() {}, end() {} }, getTraceId));
			}
		},
		startSpan(name, fn, options) {
			return runObservation(name, "span", fn, {
				...(options?.input !== undefined ? { input: sanitize(options.input) } : {}),
				...(options?.metadata ? { metadata: sanitize(options.metadata) } : {}),
			});
		},
		generation(name, fn, options) {
			return runObservation(name, "generation", fn, {
				...(options?.model ? { model: options.model } : {}),
				...(options?.input !== undefined ? { input: sanitize(options.input) } : {}),
				...(options?.metadata ? { metadata: sanitize(options.metadata) } : {}),
			});
		},
		tool(name, fn, options) {
			return runObservation(`tool:${name}`, "span", fn, {
				...(options?.input !== undefined ? { input: sanitize(options.input) } : {}),
				...(options?.metadata
					? { metadata: sanitize({ ...options.metadata, toolName: name }) }
					: { metadata: { toolName: name } }),
			});
		},
		score(input: ScoreInput) {
			const traceId = input.traceId ?? getTraceId();
			if (!traceId) return;
			void client.score
				.create({
					traceId,
					name: input.name,
					value: input.value,
					...(input.comment ? { comment: input.comment } : {}),
					...(input.dataType ? { dataType: input.dataType } : {}),
					...(input.stringValue ? { stringValue: input.stringValue } : {}),
					...(input.metadata ? { metadata: sanitize(input.metadata) } : {}),
				})
				.catch(() => undefined);
		},
		event(name: string, input?: EventInput) {
			void runObservation(name, "event", async (span) => {
				span.update({
					input: input?.input,
					metadata: input?.metadata,
				});
			}).catch(() => undefined);
		},
		currentTraceId: getTraceId,
		async flush() {
			try {
				await client.flush?.();
			} catch {
				/* ignore */
			}
		},
		async shutdown() {
			try {
				await client.flush?.();
				await client.shutdown?.();
			} catch {
				/* ignore */
			}
			try {
				await otel?.shutdown();
			} catch {
				/* ignore */
			}
		},
	};
	return obs;
}
