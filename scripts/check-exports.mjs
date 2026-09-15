/**
 * Verify every `exports` (and `main`/`types`/`bin`) target in package.json
 * exists on disk. Run before publish so a broken entry point fails here
 * rather than in a consumer's install.
 *
 * Usage:  node scripts/check-exports.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

/** Collect every relative file path referenced by exports/main/types/bin. */
function collectTargets() {
	const targets = [];
	const add = (label, value) => {
		if (typeof value === "string" && value.startsWith(".")) targets.push({ label, path: value });
	};

	add("main", pkg.main);
	add("types", pkg.types);

	if (pkg.bin && typeof pkg.bin === "object") {
		for (const [name, value] of Object.entries(pkg.bin)) {
			add(`bin["${name}"]`, value);
		}
	} else {
		add("bin", pkg.bin);
	}

	for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
		if (typeof entry === "string") {
			add(`exports["${subpath}"]`, entry);
		} else if (entry && typeof entry === "object") {
			for (const [condition, value] of Object.entries(entry)) {
				add(`exports["${subpath}"].${condition}`, value);
			}
		}
	}
	return targets;
}

const missing = [];
for (const { label, path } of collectTargets()) {
	if (!existsSync(resolve(root, path))) missing.push({ label, path });
}

if (missing.length > 0) {
	console.error("✗ package.json references files that do not exist:\n");
	for (const { label, path } of missing) console.error(`  ${label} -> ${path}`);
	console.error("\nDid you forget to add an entry point, or is the path wrong?");
	process.exit(1);
}

console.log(`✓ all ${collectTargets().length} package.json entry-point targets exist`);
