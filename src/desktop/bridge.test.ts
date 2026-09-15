import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config.ts";
import type { AgentEvent, MainModelProvider } from "../core/events.ts";
import type { ConstructAgent } from "../core/strands.ts";
import { noopObservability } from "../observability/noop.ts";
import { createHarness } from "../runtime.ts";
import { startDesktopBridge } from "./bridge.ts";

const fakeProvider: MainModelProvider = {
	kind: "fake",
	modelId: "fake",
	async *stream() {
		yield { type: "text_delta", text: "hello from the desk" };
		yield { type: "done" };
	},
};

async function withBridge(
	openUrl?: (url: string) => void,
	openPath?: (path: string, reveal: boolean) => void,
) {
	const cwd = await mkdtemp(join(tmpdir(), "harness-desk-"));
	const prevHome = process.env.HARNESS_HOME;
	process.env.HARNESS_HOME = join(cwd, "home");
	const constructAgent: ConstructAgent = () => ({
		async run(_message, emit) {
			emit({ kind: "text_delta", text: "hello from the desk" } satisfies AgentEvent);
			emit({ kind: "completion" });
		},
	});
	const harness = await createHarness({
		cwd,
		config: { ...DEFAULT_CONFIG, name: "desk" },
		provider: fakeProvider,
		constructAgent,
		observability: noopObservability,
	});
	const { ready, stop } = await startDesktopBridge({
		cwd,
		harness,
		token: "test-token",
		openUrl,
		openPath,
	});
	const headers = { authorization: "Bearer test-token", "content-type": "application/json" };
	return {
		ready,
		cwd,
		headers,
		async close() {
			await stop();
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			await rm(cwd, { recursive: true, force: true });
		},
	};
}

describe("desktop bridge", () => {
	test("rejects a missing token", async () => {
		const ctx = await withBridge();
		try {
			const res = await fetch(`${ctx.ready.url}/state`);
			expect(res.status).toBe(401);
		} finally {
			await ctx.close();
		}
	});

	test("returns state and streams a turn", async () => {
		const ctx = await withBridge();
		try {
			const state = await fetch(`${ctx.ready.url}/state`, { headers: ctx.headers });
			expect(state.ok).toBe(true);
			const body = (await state.json()) as { name: string };
			expect(body.name).toBe("desk");

			const turn = await fetch(`${ctx.ready.url}/turn`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ message: "hi" }),
			});
			expect(turn.ok).toBe(true);
			expect(turn.headers.get("content-type")).toContain("text/event-stream");
			const text = await turn.text();
			expect(text).toContain("hello from the desk");
			expect(text).toContain("completion");
		} finally {
			await ctx.close();
		}
	});

	test("transcribe rejects an empty recording", async () => {
		const ctx = await withBridge();
		try {
			const res = await fetch(`${ctx.ready.url}/transcribe`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ data: "", format: "webm" }),
			});
			expect(res.status).toBe(400);
		} finally {
			await ctx.close();
		}
	});

	test("settings reports and stores an api key without echoing it", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-settings-"));
		const prevHome = process.env.HARNESS_HOME;
		const prevKey = process.env.OPENROUTER_API_KEY;
		delete process.env.OPENROUTER_API_KEY;
		process.env.HARNESS_HOME = home;
		const ctx = await withBridge();
		try {
			const before = await fetch(`${ctx.ready.url}/settings`, { headers: ctx.headers });
			const empty = (await before.json()) as { hasApiKey: boolean; apiKeyHint: string };
			expect(empty.hasApiKey).toBe(false);

			const saved = await fetch(`${ctx.ready.url}/settings`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ apiKey: "sk-or-v1-secretkey" }),
			});
			const body = (await saved.json()) as { hasApiKey: boolean; apiKeyHint: string };
			expect(body.hasApiKey).toBe(true);
			expect(body.apiKeyHint).toBe("••••tkey");
			expect(JSON.stringify(body)).not.toContain("sk-or-v1-secretkey");
		} finally {
			await ctx.close();
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
			else process.env.OPENROUTER_API_KEY = prevKey;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("settings stores a Google OAuth client without echoing the secret", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-google-oauth-"));
		const prevHome = process.env.HARNESS_HOME;
		process.env.HARNESS_HOME = home;
		const ctx = await withBridge();
		try {
			const saved = await fetch(`${ctx.ready.url}/settings`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({
					googleClientId: "abc.apps.googleusercontent.com",
					googleClientSecret: "gsecret-value",
				}),
			});
			const body = (await saved.json()) as {
				hasGoogleOAuth: boolean;
				googleOAuthHint: string;
			};
			expect(body.hasGoogleOAuth).toBe(true);
			expect(body.googleOAuthHint).toBe("••••.com");
			expect(JSON.stringify(body)).not.toContain("gsecret-value");
		} finally {
			await ctx.close();
			if (prevHome === undefined) delete process.env.HARNESS_HOME;
			else process.env.HARNESS_HOME = prevHome;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("slash help stays off the model", async () => {
		const ctx = await withBridge();
		try {
			const res = await fetch(`${ctx.ready.url}/turn`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ message: "/help" }),
			});
			const body = (await res.json()) as { outcome: { kind: string; text?: string } };
			expect(body.outcome.kind).toBe("text");
			expect(body.outcome.text).toContain("/resume");
		} finally {
			await ctx.close();
		}
	});

	test("lists MCP integrations without tokens", async () => {
		const ctx = await withBridge();
		try {
			const res = await fetch(`${ctx.ready.url}/integrations`, { headers: ctx.headers });
			expect(res.ok).toBe(true);
			const body = (await res.json()) as {
				items: Array<{ id: string; label: string; connected: boolean }>;
			};
			expect(body.items.some((item) => item.id === "linear" && item.label === "Linear")).toBe(true);
			expect(body.items.every((item) => item.connected === false)).toBe(true);
			expect(JSON.stringify(body)).not.toContain("accessToken");
		} finally {
			await ctx.close();
		}
	});

	test("opens http links and rejects other schemes", async () => {
		const opened: string[] = [];
		const ctx = await withBridge((url) => opened.push(url));
		try {
			const ok = await fetch(`${ctx.ready.url}/open`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ url: "https://www.canva.com/d/abc" }),
			});
			expect(ok.ok).toBe(true);
			expect(opened).toEqual(["https://www.canva.com/d/abc"]);

			const bad = await fetch(`${ctx.ready.url}/open`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ url: "javascript:alert(1)" }),
			});
			expect(bad.status).toBe(400);
			expect(opened).toHaveLength(1);
		} finally {
			await ctx.close();
		}
	});

	test("opens a local path", async () => {
		const opened: Array<{ path: string; reveal: boolean }> = [];
		const ctx = await withBridge(undefined, (path, reveal) => opened.push({ path, reveal }));
		try {
			const file = join(tmpdir(), `harness-open-file-${Date.now()}.txt`);
			await writeFile(file, "ok");
			try {
				const ok = await fetch(`${ctx.ready.url}/open-path`, {
					method: "POST",
					headers: ctx.headers,
					body: JSON.stringify({ path: file, reveal: true }),
				});
				expect(ok.ok).toBe(true);
				expect(opened).toEqual([{ path: file, reveal: true }]);
			} finally {
				await rm(file, { force: true });
			}
		} finally {
			await ctx.close();
		}
	});

	test("rejects a missing local path", async () => {
		const ctx = await withBridge();
		try {
			const missing = await fetch(`${ctx.ready.url}/open-path`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ path: "/no/such/caelence-file.txt" }),
			});
			expect(missing.status).toBe(400);
			const body = (await missing.json()) as { error?: string };
			expect(body.error).toBe("File is missing.");
		} finally {
			await ctx.close();
		}
	});

	test("embed rejects local and non-http urls", async () => {
		const ctx = await withBridge();
		try {
			const local = await fetch(`${ctx.ready.url}/embed`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ url: "http://127.0.0.1/secret" }),
			});
			expect(local.status).toBe(400);
			const bad = await fetch(`${ctx.ready.url}/embed`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ url: "javascript:alert(1)" }),
			});
			expect(bad.status).toBe(400);
		} finally {
			await ctx.close();
		}
	});

	test("renames and deletes a session", async () => {
		const ctx = await withBridge();
		try {
			const turn = await fetch(`${ctx.ready.url}/turn`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ message: "hello world" }),
			});
			expect(turn.ok).toBe(true);
			await turn.text();
			const listed = await fetch(`${ctx.ready.url}/sessions`, { headers: ctx.headers });
			const before = (await listed.json()) as { items: Array<{ id: string; label: string }> };
			expect(before.items).toHaveLength(1);
			const id = before.items[0]?.id ?? "";
			expect(id).toBeTruthy();

			const empty = await fetch(`${ctx.ready.url}/session`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ id, title: "   " }),
			});
			expect(empty.status).toBe(400);

			const renamed = await fetch(`${ctx.ready.url}/session`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ id, title: "  Billing copy  " }),
			});
			const renamedBody = (await renamed.json()) as { title: string };
			expect(renamedBody.title).toBe("Billing copy");
			const afterRename = await fetch(`${ctx.ready.url}/sessions`, { headers: ctx.headers });
			const renamedList = (await afterRename.json()) as { items: Array<{ label: string }> };
			expect(renamedList.items[0]?.label).toBe("Billing copy");

			const deleted = await fetch(`${ctx.ready.url}/session`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({ id, delete: true }),
			});
			const deletedBody = (await deleted.json()) as { cleared: boolean };
			expect(deletedBody.cleared).toBe(true);
			const afterDelete = await fetch(`${ctx.ready.url}/sessions`, { headers: ctx.headers });
			const emptyList = (await afterDelete.json()) as { items: unknown[] };
			expect(emptyList.items).toEqual([]);
		} finally {
			await ctx.close();
		}
	});

	test("saves turn attachments and allows an attachments-only message", async () => {
		const ctx = await withBridge();
		try {
			const turn = await fetch(`${ctx.ready.url}/turn`, {
				method: "POST",
				headers: ctx.headers,
				body: JSON.stringify({
					message: "",
					attachments: [
						{
							name: "note.txt",
							mime: "text/plain",
							data: Buffer.from("from the composer").toString("base64"),
						},
					],
				}),
			});
			expect(turn.ok).toBe(true);
			await turn.text();
			const names = await readdir(join(ctx.cwd, ".harness", "uploads"));
			expect(names.some((name) => name.endsWith("-note.txt"))).toBe(true);
			const file = names.find((name) => name.endsWith("-note.txt"));
			expect(await readFile(join(ctx.cwd, ".harness", "uploads", file ?? ""), "utf8")).toBe(
				"from the composer",
			);
		} finally {
			await ctx.close();
		}
	});
});
