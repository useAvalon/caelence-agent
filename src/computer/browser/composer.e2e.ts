import { spawn } from "node:child_process";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { executeOnPage, type PagePort } from "./executor.ts";
import { PAGE_RUNTIME } from "./runtime.ts";
import type { BrowserAction } from "./session.ts";

const PORT = Number(process.env.PORT ?? 4391);
const TEXT = "Testing the agent composer flow.\nLine two with #hashtag and an emoji 🫐";
const root = join(import.meta.dir, "../../..");

const actions: BrowserAction[] = [
	{
		kind: "click",
		role: "button",
		name: "Start a post",
		label: "Opening the field",
		expect: "dialog_opens",
	},
	{
		kind: "type",
		role: "textbox",
		name: "creating content",
		text: TEXT,
		label: "Writing",
		expect: "text_equals",
	},
];

const server = spawn("bun", ["fixture/server.ts"], {
	cwd: root,
	stdio: "ignore",
	env: { ...process.env, PORT: String(PORT) },
});

const browser = await chromium.launch({ headless: true });
try {
	await waitForServer();
	const page = await browser.newPage();
	await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
	await page.evaluate(PAGE_RUNTIME);
	const result = await executeOnPage(playwrightPort(page), actions, {
		stableMs: 1000,
		moveCursor: async () => undefined,
	});
	const typed = await page.evaluate<string>(
		`window.__agOps.read(${JSON.stringify({ role: "textbox", name: "creating content" })})`,
	);
	const actual = String(typed).replace(/\s+/g, " ").trim();
	const expected = TEXT.replace(/\s+/g, " ").trim();
	if (result.stopped || actual !== expected) {
		console.error(result.observation);
		console.error({ actual, expected, stopped: result.stopped });
		process.exitCode = 1;
	} else {
		console.log(`composer e2e passed (${actual.length} characters)`);
	}
	await page.close();
} finally {
	await browser.close();
	server.kill();
}

function playwrightPort(page: Page): PagePort {
	return {
		evaluate: (expression) => page.evaluate(expression),
		clickAt: async (x, y) => {
			await page.mouse.click(x, y);
		},
		typeChars: async (text) => {
			await page.keyboard.type(text, { delay: 8 });
		},
		insertText: async (text) => {
			await page.keyboard.insertText(text);
		},
		press: async (key) => {
			await page.keyboard.press(key);
		},
		reinject: async () => {
			await page.evaluate(PAGE_RUNTIME);
		},
	};
}

async function waitForServer(): Promise<void> {
	const deadline = Date.now() + 8_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${PORT}/`);
			if (res.ok) return;
		} catch {
			// Server is still starting.
		}
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	throw new Error("Fixture server did not start.");
}
