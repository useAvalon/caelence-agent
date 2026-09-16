import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Observability } from "./types.ts";

export interface PromptRecord {
	name: string;
	body: string;
	label?: string;
}

export function promptVersionHash(body: string): string {
	return createHash("sha256").update(body).digest("hex").slice(0, 12);
}

export const WEBSITE_PROMPT_FILES: Record<string, string> = {
	website_planner: "to-spec",
	design_system_generator: "to-design",
	page_generator: "to-sitemap",
	code_generator: "implement",
	code_reviewer: "code-review",
	browser_debugger: "tdd",
	content_generator: "to-design-brief",
};

export function promptVersionMap(bodies: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, body] of Object.entries(bodies)) {
		out[name] = promptVersionHash(body);
	}
	return out;
}

/** Git-backed copy / visual-QA skills shipped with the package. */
export function harnessPromptRecords(): PromptRecord[] {
	const dir = join(import.meta.dir, "..", "..", "skills");
	const out: PromptRecord[] = [];
	for (const name of ["copywriting", "impeccable"] as const) {
		try {
			out.push({ name, body: readFileSync(join(dir, name, "SKILL.md"), "utf8") });
		} catch {}
	}
	return out;
}

/**
 * Upsert named prompts in Langfuse. Fail-soft: git remains the source of truth
 * and production never waits on this network call.
 */
export async function syncPrompts(input: {
	prompts: PromptRecord[];
	env?: Record<string, string | undefined>;
}): Promise<{ synced: string[]; skipped: boolean }> {
	const env = input.env ?? process.env;
	if (!env.LANGFUSE_SECRET_KEY?.trim() || !env.LANGFUSE_PUBLIC_KEY?.trim()) {
		return { synced: [], skipped: true };
	}
	try {
		const mod = (await import("@langfuse/client")) as {
			LangfuseClient: new (
				opts?: Record<string, unknown>,
			) => {
				prompt: {
					create(body: Record<string, unknown>): Promise<unknown>;
				};
			};
		};
		const client = new mod.LangfuseClient({
			publicKey: env.LANGFUSE_PUBLIC_KEY,
			secretKey: env.LANGFUSE_SECRET_KEY,
			...(env.LANGFUSE_BASE_URL?.trim() ? { baseUrl: env.LANGFUSE_BASE_URL.trim() } : {}),
		});
		const synced: string[] = [];
		for (const prompt of input.prompts) {
			const version = promptVersionHash(prompt.body);
			await client.prompt.create({
				name: prompt.name,
				prompt: prompt.body,
				labels: prompt.label ? [prompt.label] : ["production"],
				commitMessage: version,
			});
			synced.push(`${prompt.name}:${version}`);
		}
		return { synced, skipped: false };
	} catch {
		return { synced: [], skipped: true };
	}
}

export function recordPromptVersions(
	obs: Observability,
	versions: Record<string, string>,
	traceId?: string,
): void {
	obs.event("prompt_versions", {
		metadata: { ...versions, ...(traceId ? { traceId } : {}) },
	});
}
