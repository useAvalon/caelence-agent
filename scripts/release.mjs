/**
 * Publish the current version to npm, then tag it. Called by the Release workflow after the
 * "release: version packages" pull request merges. Safe to run again: a version that is already
 * on npm is skipped, so a retry can finish tagging after a partial run.
 *
 * Usage:  node scripts/release.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

function run(cmd, args) {
	const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function onNpm(name, version) {
	const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], {
		cwd: root,
		encoding: "utf8",
	});
	return result.status === 0 && result.stdout.trim() === version;
}

if (onNpm(pkg.name, pkg.version)) {
	console.log(`${pkg.name}@${pkg.version} is already on npm; skipping publish.`);
} else {
	run("npm", ["publish", "--tag", "latest", "--access", "public"]);
}

// Creates the git tag (v<version>) and records it in CHANGESETS_OUTPUT, which changesets/action
// reads to push the tag and create the GitHub Release.
run("bunx", ["changeset", "git-tag"]);
