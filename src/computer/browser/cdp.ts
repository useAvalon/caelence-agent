import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_PORT = 9222;

export function agentChromeUserDataDir(): string {
	return join(homedir(), ".agent-chrome");
}

export function chromeExecutable(): string | undefined {
	const candidates = [
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
	];
	return candidates.find((path) => existsSync(path));
}

export interface CdpTarget {
	id: string;
	type: string;
	title: string;
	url: string;
	webSocketDebuggerUrl?: string;
}

export async function listCdpTargets(port = DEFAULT_PORT): Promise<CdpTarget[]> {
	const res = await fetch(`http://127.0.0.1:${port}/json/list`);
	if (!res.ok) throw new Error(`Chrome debug port ${port} is not reachable.`);
	return (await res.json()) as CdpTarget[];
}

export async function tryExistingChrome(port = DEFAULT_PORT): Promise<number | undefined> {
	try {
		await listCdpTargets(port);
		return port;
	} catch {
		return undefined;
	}
}

/** The debug port of a separately launched profile is not the user's Chrome. */
export async function tryUserChrome(port = DEFAULT_PORT): Promise<number | undefined> {
	if ((await tryExistingChrome(port)) === undefined) return undefined;
	if (await debugPortIsAgentProfile(port)) return undefined;
	return port;
}

export async function quitAgentChrome(): Promise<void> {
	const dir = agentChromeUserDataDir();
	let stdout = "";
	try {
		const result = await execFileAsync("/bin/ps", ["-ax", "-o", "pid=,command="], {
			timeout: 2_000,
			maxBuffer: 2_000_000,
		});
		stdout = result.stdout;
	} catch {
		return;
	}
	for (const line of stdout.split("\n")) {
		if (!line.includes(dir) || !line.includes("Google Chrome")) continue;
		const pid = Number(line.trim().split(/\s+/)[0]);
		if (!pid) continue;
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// Already gone.
		}
	}
}

async function debugPortIsAgentProfile(port: number): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync("/bin/ps", ["-ax", "-o", "command="], {
			timeout: 2_000,
			maxBuffer: 2_000_000,
		});
		const dir = agentChromeUserDataDir();
		return stdout
			.split("\n")
			.some((line) => line.includes(`remote-debugging-port=${port}`) && line.includes(dir));
	} catch {
		return false;
	}
}

export async function ensureChrome(
	options: { port?: number; userDataDir?: string } = {},
): Promise<number> {
	const port = options.port ?? DEFAULT_PORT;
	try {
		await listCdpTargets(port);
		return port;
	} catch {
		const bin = chromeExecutable();
		if (!bin) throw new Error("Chrome is not installed.");
		const userDataDir = options.userDataDir ?? agentChromeUserDataDir();
		spawn(
			bin,
			[
				`--remote-debugging-port=${port}`,
				`--user-data-dir=${userDataDir}`,
				"--no-first-run",
				"--no-default-browser-check",
			],
			{ detached: true, stdio: "ignore" },
		).unref();
		const deadline = Date.now() + 12_000;
		while (Date.now() < deadline) {
			try {
				await listCdpTargets(port);
				return port;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}
		throw new Error("Chrome did not open a debug port in time.");
	}
}

export class CdpConnection {
	private socket: WebSocket;
	private nextId = 0;
	private pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (err: Error) => void }
	>();

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.addEventListener("message", (event) => {
			const raw = typeof event.data === "string" ? event.data : "";
			let parsed: { id?: number; result?: unknown; error?: { message?: string } };
			try {
				parsed = JSON.parse(raw) as typeof parsed;
			} catch {
				return;
			}
			if (typeof parsed.id !== "number") return;
			const waiter = this.pending.get(parsed.id);
			if (!waiter) return;
			this.pending.delete(parsed.id);
			if (parsed.error) waiter.reject(new Error(parsed.error.message ?? "CDP error"));
			else waiter.resolve(parsed.result);
		});
	}

	static async open(wsUrl: string): Promise<CdpConnection> {
		const socket = new WebSocket(wsUrl);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve(), { once: true });
			socket.addEventListener("error", () => reject(new Error("Chrome WebSocket failed.")), {
				once: true,
			});
		});
		return new CdpConnection(socket);
	}

	async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
		this.nextId += 1;
		const id = this.nextId;
		const payload = JSON.stringify({ id, method, params });
		return await new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
			});
			this.socket.send(payload);
		});
	}

	async evaluate<T>(expression: string): Promise<T> {
		const result = await this.send<{
			result?: { value?: T };
			exceptionDetails?: { text?: string; exception?: { description?: string } };
		}>("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (result.exceptionDetails) {
			const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
			throw new Error(detail || "Page script failed.");
		}
		return result.result?.value as T;
	}

	async mouseClick(x: number, y: number): Promise<void> {
		await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
		await this.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x,
			y,
			button: "left",
			clickCount: 1,
		});
		await this.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x,
			y,
			button: "left",
			clickCount: 1,
		});
	}

	async insertText(text: string): Promise<void> {
		await this.send("Input.insertText", { text });
	}

	async typeChars(text: string): Promise<void> {
		for (const ch of text) {
			await this.send("Input.dispatchKeyEvent", {
				type: "keyDown",
				text: ch,
				key: ch,
				unmodifiedText: ch,
			});
			await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
			await new Promise((resolve) => setTimeout(resolve, 14));
		}
	}

	async pressKey(key: "Enter" | "Escape" | "Backspace" | "Space"): Promise<void> {
		const spec = {
			Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
			Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
			Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
			Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
		}[key];
		await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...spec });
		await this.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: spec.key,
			code: spec.code,
			windowsVirtualKeyCode: spec.windowsVirtualKeyCode,
		});
	}

	async screenshotPng(): Promise<Buffer> {
		const result = await this.send<{ data?: string }>("Page.captureScreenshot", { format: "png" });
		return Buffer.from(result.data ?? "", "base64");
	}

	/** Viewport origin in screen pixels, including the browser toolbar. */
	async windowOrigin(): Promise<{ x: number; y: number } | undefined> {
		try {
			const target = await this.send<{ windowId: number }>("Browser.getWindowForTarget");
			const win = await this.send<{
				bounds: { left?: number; top?: number };
			}>("Browser.getWindowBounds", { windowId: target.windowId });
			const chrome = await this.evaluate<{ dh: number; dw: number }>(
				"({ dh: Math.max(0, window.outerHeight - window.innerHeight), dw: Math.max(0, window.outerWidth - window.innerWidth) })",
			);
			return {
				x: (win.bounds.left ?? 0) + chrome.dw / 2,
				y: (win.bounds.top ?? 0) + chrome.dh,
			};
		} catch {
			return undefined;
		}
	}

	close(): void {
		this.socket.close();
	}
}

export async function attachPage(port: number, preferUrl?: string): Promise<CdpConnection> {
	const targets = (await listCdpTargets(port)).filter(
		(item) => item.type === "page" && item.webSocketDebuggerUrl,
	);
	if (targets.length === 0) throw new Error("Chrome has no pages to attach to.");
	const match = preferUrl ? targets.find((item) => item.url.includes(preferUrl)) : undefined;
	const target = match ?? targets[0];
	if (!target?.webSocketDebuggerUrl) throw new Error("Chrome page has no debugger URL.");
	const cdp = await CdpConnection.open(target.webSocketDebuggerUrl);
	await cdp.send("Runtime.enable");
	await cdp.send("Page.enable");
	await cdp.send("Page.setBypassCSP", { enabled: true }).catch(() => undefined);
	return cdp;
}
