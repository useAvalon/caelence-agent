/** One-click MCP catalog. Same hosted servers as the Caelence builder. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type McpAuthKind = "dcr" | "google" | "microsoft" | "desktop" | "oauth_preregistered";

export interface McpCatalogEntry {
	id: string;
	label: string;
	description: string;
	mcpUrl: string;
	docsUrl: string;
	glyph: string;
	scopes: readonly string[];
	auth?: McpAuthKind;
}

export type IntegrationLogoKind = "mask" | "image";

export const MCP_CATALOG: readonly McpCatalogEntry[] = JSON.parse(
	readFileSync(join(import.meta.dir, "catalog-data.json"), "utf8"),
) as McpCatalogEntry[];

let liveCatalog: McpCatalogEntry[] | undefined;

export function setLiveCatalog(entries: McpCatalogEntry[] | undefined): void {
	liveCatalog = entries;
}

export function findMcpCatalog(id: string): McpCatalogEntry | undefined {
	return (liveCatalog ?? MCP_CATALOG).find((item) => item.id === id);
}

/** One-click DCR first, then desktop MCP, then user-owned OAuth clients. */
export function listedMcpCatalog(): McpCatalogEntry[] {
	const rows = liveCatalog ?? [...MCP_CATALOG];
	return [...rows].sort((a, b) => listRank(a) - listRank(b));
}

export function needsDesktopMcp(item: { auth?: McpAuthKind }): boolean {
	return item.auth === "desktop";
}

export function needsUserOAuth(item: { auth?: McpAuthKind }): boolean {
	return item.auth === "google" || item.auth === "microsoft";
}

function listRank(item: { auth?: McpAuthKind }): number {
	if (needsUserOAuth(item)) return 2;
	if (needsDesktopMcp(item)) return 1;
	return 0;
}

const MARKS_DIR = join(import.meta.dir, "marks");
const MIME_BY_EXT = {
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
} as const;

function localMark(id: string): { file: string; mime: string } | undefined {
	for (const ext of ["svg", "png", "jpg"] as const) {
		const file = `${id}.${ext}`;
		if (existsSync(join(MARKS_DIR, file))) {
			return { file, mime: MIME_BY_EXT[ext] };
		}
	}
	return undefined;
}

function markDataUrl(file: string, mime: string): string {
	const buf = readFileSync(join(MARKS_DIR, file));
	if (mime === "image/svg+xml") {
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buf.toString("utf8"))}`;
	}
	return `data:${mime};base64,${buf.toString("base64")}`;
}

export function integrationLogoUrl(id: string): string {
	const local = localMark(id);
	if (!local) {
		const letter = id.slice(0, 2).toUpperCase();
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#6e93b8"/><text x="16" y="21" text-anchor="middle" font-size="12" fill="#fff" font-family="sans-serif">${letter}</text></svg>`;
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	}
	return markDataUrl(local.file, local.mime);
}

export function integrationLogoKind(_id: string): IntegrationLogoKind {
	return "image";
}
