import { isAbsolute, relative, resolve, sep } from "node:path";

export class PathEscapeError extends Error {
	constructor(rel: string) {
		super(`Path escapes project root: ${rel}`);
		this.name = "PathEscapeError";
	}
}

/** Resolve `rel` under `cwd`. Rejects absolute paths and `..` that leave the root. */
export function resolveUnderCwd(cwd: string, rel: string): string {
	if (!rel || rel.trim() === "") throw new PathEscapeError(rel);
	if (isAbsolute(rel)) throw new PathEscapeError(rel);
	const root = resolve(cwd);
	const resolved = resolve(root, rel);
	const relToRoot = relative(root, resolved);
	if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
		throw new PathEscapeError(rel);
	}
	return resolved;
}

export function toProjectRel(cwd: string, abs: string): string {
	const rel = relative(resolve(cwd), abs);
	return rel.split(sep).join("/");
}

export const SKIP_DIR_NAMES = new Set([
	"node_modules",
	".git",
	".harness",
	"dist",
	".output",
	".bun",
]);

export function shouldSkipDir(name: string): boolean {
	return SKIP_DIR_NAMES.has(name);
}
