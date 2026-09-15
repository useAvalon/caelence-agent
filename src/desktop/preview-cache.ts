import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { harnessHome } from "../desktop/secrets.ts";

export function previewCacheKey(href: string): string {
	return createHash("sha256").update(stablePreviewKey(href)).digest("hex");
}

export function stablePreviewKey(href: string): string {
	try {
		const url = new URL(href);
		const canvaId = /\/id:([^/]+)/.exec(url.pathname)?.[1];
		if (canvaId) return `canva:${canvaId}`;
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return href;
	}
}

function previewDir(env: Record<string, string | undefined> = process.env): string {
	return resolve(harnessHome(env), "previews");
}

function previewPath(href: string, env: Record<string, string | undefined> = process.env): string {
	return resolve(previewDir(env), `${previewCacheKey(href)}.bin`);
}

function metaPath(href: string, env: Record<string, string | undefined> = process.env): string {
	return resolve(previewDir(env), `${previewCacheKey(href)}.type`);
}

export function readPreviewCache(
	href: string,
	env: Record<string, string | undefined> = process.env,
): { type: string; bytes: Uint8Array } | null {
	const file = previewPath(href, env);
	if (!existsSync(file)) return null;
	try {
		const bytes = new Uint8Array(readFileSync(file));
		if (bytes.byteLength === 0) return null;
		const type = existsSync(metaPath(href, env))
			? readFileSync(metaPath(href, env), "utf8").trim()
			: "image/png";
		return { type: type || "image/png", bytes };
	} catch {
		return null;
	}
}

export function writePreviewCache(
	href: string,
	type: string,
	bytes: Uint8Array,
	env: Record<string, string | undefined> = process.env,
): void {
	const dir = previewDir(env);
	mkdirSync(dir, { recursive: true });
	writeFileSync(previewPath(href, env), bytes);
	writeFileSync(metaPath(href, env), `${type}\n`);
}
