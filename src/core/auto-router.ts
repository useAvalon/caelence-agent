export function autoRouterPluginId(model: string): "auto-router" | "auto-beta-router" | undefined {
	if (model === "openrouter/auto") return "auto-router";
	if (model === "openrouter/auto-beta") return "auto-beta-router";
	return undefined;
}

export interface AutoRouterInjectOptions {
	model: string;
	sessionId?: string;
	/** OpenRouter cost band. Agent work defaults to high. */
	costTier?: "low" | "medium" | "high" | "xhigh" | "max";
}

/** Add Auto Router plugin settings and session stickiness to a chat-completions body. */
export function injectAutoRouterPayload(body: unknown, options: AutoRouterInjectOptions): unknown {
	if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
	const rec = body as Record<string, unknown>;
	const model = typeof rec.model === "string" ? rec.model : options.model;
	const pluginId = autoRouterPluginId(model);
	if (!pluginId) return body;
	const next: Record<string, unknown> = { ...rec };
	const sessionId = options.sessionId?.trim();
	if (sessionId && typeof next.session_id !== "string") next.session_id = sessionId;
	const plugins = Array.isArray(next.plugins) ? [...next.plugins] : [];
	const costTier = options.costTier ?? "high";
	const index = plugins.findIndex(
		(item) =>
			typeof item === "object" && item !== null && (item as { id?: unknown }).id === pluginId,
	);
	if (index >= 0) {
		const prev = plugins[index] as Record<string, unknown>;
		plugins[index] = {
			...prev,
			cost_tier: prev.cost_tier ?? prev.costTier ?? costTier,
		};
	} else {
		plugins.push({ id: pluginId, cost_tier: costTier });
	}
	next.plugins = plugins;
	return next;
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function withAutoRouterFetch(
	baseFetch: FetchFn,
	options: { model: string; sessionId?: () => string | undefined },
): FetchFn {
	if (!autoRouterPluginId(options.model)) return baseFetch;
	return async (input, init) => {
		const headers = new Headers(init?.headers);
		const sessionId = options.sessionId?.()?.trim();
		if (sessionId) headers.set("x-session-id", sessionId);
		let body = init?.body;
		if (typeof body === "string") {
			try {
				body = JSON.stringify(
					injectAutoRouterPayload(JSON.parse(body), { model: options.model, sessionId }),
				);
			} catch {
				// leave the original body
			}
		}
		return baseFetch(input, { ...init, headers, body });
	};
}
