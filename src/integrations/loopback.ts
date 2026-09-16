import { type OAuthCallback, oauthResultPage } from "./connect.ts";

export interface OAuthLoopback {
	redirectUri: string;
	waitForCallback: (state: string) => Promise<OAuthCallback>;
	stop: () => void;
}

function html(body: string, status: number): Response {
	return new Response(body, {
		status,
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
	});
}

/** Loopback HTTP server so a TUI or CLI can finish MCP OAuth in the browser. */
export function startOAuthLoopback(options?: { timeoutMs?: number }): OAuthLoopback {
	const waiters = new Map<string, (result: OAuthCallback) => void>();
	const timeoutMs = options?.timeoutMs ?? 180_000;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(req) {
			const url = new URL(req.url);
			if (req.method !== "GET" || url.pathname !== "/oauth/callback") {
				return new Response("Not found", { status: 404 });
			}
			const state = url.searchParams.get("state")?.trim() ?? "";
			const code = url.searchParams.get("code")?.trim() ?? "";
			const error = url.searchParams.get("error")?.trim() ?? "";
			const resolve = waiters.get(state);
			if (!resolve) {
				return html(
					oauthResultPage(
						false,
						"This sign-in is no longer waiting. Close this tab and try Connect again.",
					),
					400,
				);
			}
			waiters.delete(state);
			resolve({ code: code || undefined, error: error || undefined });
			const ok = Boolean(code) && !error;
			return html(
				oauthResultPage(
					ok,
					ok
						? "You can close this tab and return to Caelence agent."
						: "Close this tab and try Connect again.",
				),
				ok ? 200 : 400,
			);
		},
	});
	return {
		redirectUri: `http://127.0.0.1:${server.port}/oauth/callback`,
		waitForCallback(state) {
			return new Promise<OAuthCallback>((resolve, reject) => {
				const timer = setTimeout(() => {
					waiters.delete(state);
					reject(new Error("Sign-in timed out. Try Connect again."));
				}, timeoutMs);
				waiters.set(state, (result) => {
					clearTimeout(timer);
					resolve(result);
				});
			});
		},
		stop() {
			server.stop();
		},
	};
}

export async function withOAuthLoopback<T>(
	run: (ctx: {
		redirectUri: string;
		waitForCallback: (state: string) => Promise<OAuthCallback>;
	}) => Promise<T>,
	options?: { timeoutMs?: number },
): Promise<T> {
	const loopback = startOAuthLoopback(options);
	try {
		return await run({
			redirectUri: loopback.redirectUri,
			waitForCallback: loopback.waitForCallback,
		});
	} finally {
		loopback.stop();
	}
}
