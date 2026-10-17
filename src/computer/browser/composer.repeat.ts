import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachPage, chromeExecutable, listCdpTargets } from "./cdp.ts";
import { executeOnPage, type PagePort } from "./executor.ts";
import { PAGE_RUNTIME } from "./runtime.ts";
import type { BrowserAction } from "./session.ts";

const RUNS = Number(process.env.RUNS ?? 20);
const PORT = Number(process.env.CDP_PORT ?? 9333);
const TEXT = "Testing the agent composer flow. Line two with #hashtag and an emoji 🫐";

const actions: BrowserAction[] = [
	{
		kind: "click",
		role: "button",
		name: "Start a post",
		label: "Opening the composer",
		expect: "dialog_opens",
	},
	{
		kind: "type",
		role: "textbox",
		name: "creating content",
		text: TEXT,
		label: "Writing the post",
		expect: "text_equals",
	},
	{
		kind: "click",
		role: "button",
		name: "Post",
		label: "Posting",
		risky: true,
	},
];

const bin = chromeExecutable();
if (!bin) {
	console.error("Chrome is not installed.");
	process.exit(1);
}

const userData = await mkdtemp(join(tmpdir(), "caelence-composer-"));
const server = spawn("bun", ["fixture/server.ts"], {
	stdio: "ignore",
	cwd: join(import.meta.dir, "../../.."),
});
const chrome = spawn(
	bin,
	[
		"--headless=new",
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${userData}`,
		"--no-first-run",
		"--no-default-browser-check",
		"about:blank",
	],
	{ stdio: "ignore" },
);

const results: { ok: boolean; ms: number; error?: string }[] = [];
try {
	await waitForPort();
	const cdp = await attachPage(PORT, "about:blank");
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_RUNTIME });
	const port = pagePort(cdp);
	const risky = actions[2];
	if (!risky?.risky) throw new Error("The Post action must stay behind the confirm gate.");
	for (let i = 0; i < RUNS; i++) {
		await cdp.send("Page.navigate", { url: "http://127.0.0.1:4321/" });
		await cdp.evaluate("document.readyState").catch(() => undefined);
		await sleep(400);
		await cdp.evaluate(PAGE_RUNTIME);
		const started = Date.now();
		try {
			const result = await executeOnPage(port, actions.slice(0, 2), {
				runId: "composer-fixture",
				stableMs: 1000,
				moveCursor: async () => undefined,
			});
			const typed = await cdp.evaluate<string>(
				`window.__agOps.read(${JSON.stringify({ role: "textbox", name: "creating content" })})`,
			);
			const ok = typed.replace(/\s+/g, " ").trim() === TEXT && !result.stopped;
			results.push({ ok, ms: Date.now() - started, error: result.stopped });
		} catch (err) {
			results.push({ ok: false, ms: Date.now() - started, error: String(err) });
		}
	}
	cdp.close();
} finally {
	chrome.kill();
	server.kill();
	await rm(userData, { recursive: true, force: true });
}

const passed = results.filter((item) => item.ok).length;
const times = results.map((item) => item.ms).sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)] ?? 0;
console.table(results);
console.log(`${passed}/${RUNS} passed, median ${median} ms`);
process.exit(passed === RUNS ? 0 : 1);

function pagePort(cdp: Awaited<ReturnType<typeof attachPage>>): PagePort {
	return {
		evaluate: (expression) => cdp.evaluate(expression),
		clickAt: (x, y) => cdp.mouseClick(x, y),
		typeChars: (text) => cdp.typeChars(text),
		insertText: (text) => cdp.insertText(text),
		press: (key) => cdp.pressKey(key),
		screenshot: async (file) => {
			const { writeFile } = await import("node:fs/promises");
			await writeFile(file, await cdp.screenshotPng());
		},
		windowOrigin: () => cdp.windowOrigin(),
	};
}

async function waitForPort(): Promise<void> {
	const deadline = Date.now() + 12_000;
	while (Date.now() < deadline) {
		try {
			await listCdpTargets(PORT);
			return;
		} catch {
			await sleep(200);
		}
	}
	throw new Error("Chrome did not open a debug port.");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
