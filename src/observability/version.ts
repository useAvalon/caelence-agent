import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function readPackageVersion(fromFile: string): string | undefined {
	try {
		const dir = dirname(fromFile);
		for (const candidate of [join(dir, "package.json"), join(dir, "..", "..", "package.json")]) {
			try {
				const raw = readFileSync(candidate, "utf8");
				const parsed = JSON.parse(raw) as { version?: unknown; name?: unknown };
				if (typeof parsed.version === "string" && parsed.version.trim())
					return parsed.version.trim();
			} catch {}
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Explicit `CAELENCE_AGENT_VERSION` wins. Otherwise the nearest package version
 * (passed in by the host) or this harness package version.
 */
export function resolveAgentVersion(fallback?: string, env = process.env): string {
	const fromEnv = env.CAELENCE_AGENT_VERSION?.trim();
	if (fromEnv) return fromEnv;
	if (fallback?.trim()) return fallback.trim();
	return readPackageVersion(fileURLToPath(import.meta.url)) ?? "0.0.0";
}

export function resolveEnvironment(env = process.env): string {
	return env.LANGFUSE_TRACING_ENVIRONMENT?.trim() || env.NODE_ENV?.trim() || "development";
}

export function langfuseKeysPresent(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return Boolean(env.LANGFUSE_SECRET_KEY?.trim() && env.LANGFUSE_PUBLIC_KEY?.trim());
}
