import { readFileSync } from "node:fs";

const overlay = readFileSync(new URL("./page/overlay.js", import.meta.url), "utf8");
const snapshot = readFileSync(new URL("./page/snapshot.js", import.meta.url), "utf8");
const ops = readFileSync(new URL("./page/ops.js", import.meta.url), "utf8");

/** One expression. Page.evaluate and AppleScript both wrap this as a return value. */
export const PAGE_RUNTIME = [
	"(() => {",
	"  if (window.__ag && window.__ag.version === 3 && window.__agOps && window.__agSnap) return window.__ag.version;",
	overlay,
	snapshot,
	ops,
	"  return window.__ag.version;",
	"})()",
].join("\n");

export const PAGE_RUNTIME_VERSION = 3;
