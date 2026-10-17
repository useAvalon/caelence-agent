import { nativeAxSnapshot } from "./ax.ts";

export interface NativeBridge {
	snapshot(app?: string): Promise<string>;
	press(ref: string): Promise<string>;
	pressName(name: string): Promise<string>;
	pressCompose(app?: string): Promise<string>;
	setValue(ref: string, value: string): Promise<string>;
	typeText(text: string, app?: string): Promise<string>;
	keys(combo: string): Promise<string>;
	clickAt(x: number, y: number): Promise<void>;
	frame(ref: string): Promise<{ x: number; y: number; w: number; h: number } | undefined>;
	windowFrame(app?: string): Promise<{ x: number; y: number; w: number; h: number } | undefined>;
	status(label: string): Promise<void>;
	confirm(summary: string): Promise<"allow" | "decline" | "stop">;
	choose(summary: string, buttons: string[]): Promise<string>;
	world(): Promise<{ text: string; ageMs: number; sparse: boolean; jpeg?: string }>;
	takeoverRequest(input: {
		summary: string;
		estimateMs: number;
		app?: string;
	}): Promise<{ skipped?: boolean; aborted?: boolean; ok?: boolean }>;
	takeoverMove(x: number, y: number): Promise<void>;
	takeoverClick(x: number, y: number): Promise<void>;
	takeoverDrag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
	takeoverKey(key: string): Promise<void>;
	takeoverType(text: string): Promise<void>;
	takeoverEnd(): Promise<void>;
}

let registered: { url: string; token: string } | undefined;

export function registerNativeBridge(url: string, token: string): void {
	registered = { url: url.replace(/\/+$/, ""), token };
}

export function nativeBridgeRegistered(): boolean {
	return Boolean(registered);
}

async function rpc<T>(kind: string, payload: unknown): Promise<T> {
	if (!registered) throw new Error("Swift native bridge is not connected.");
	const res = await fetch(`${registered.url}/rpc`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${registered.token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ v: 1, id: crypto.randomUUID(), kind, payload }),
	});
	if (!res.ok) throw new Error(`Native ${kind} failed (${res.status}).`);
	return (await res.json()) as T;
}

export const nativeBridge: NativeBridge = {
	async snapshot(app) {
		if (registered) {
			const result = await rpc<{ text?: string }>("ax.snapshot", { app });
			if (result.text) return result.text;
		}
		return nativeAxSnapshot();
	},
	async press(ref) {
		if (registered) {
			await rpc("ax.press", { ref });
			return `Pressed ${ref}.`;
		}
		return `No Swift bridge; cannot press ${ref}.`;
	},
	async pressName(name) {
		if (registered) {
			const result = await rpc<{ ok?: boolean }>("ax.pressName", { name });
			return result.ok ? `Pressed “${name}”.` : `No control named “${name}”.`;
		}
		return `No Swift bridge; cannot press “${name}”.`;
	},
	async pressCompose(app?: string) {
		if (registered) {
			const result = await rpc<{ ok?: boolean }>("ax.pressCompose", { app });
			return result.ok ? "Pressed compose." : "No compose control.";
		}
		return "No Swift bridge; cannot press compose.";
	},
	async setValue(ref, value) {
		if (registered) {
			await rpc("ax.setValue", { ref, value });
			return `Set ${ref}.`;
		}
		return `No Swift bridge; cannot type into ${ref}.`;
	},
	async typeText(text, app) {
		if (!app) return "Could not type.";
		if (registered) {
			const result = await rpc<{ ok?: boolean }>("ax.type", { text, app });
			return result.ok === false ? "Could not type." : "Typed.";
		}
		try {
			const { execFile } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const run = promisify(execFile);
			const target = app.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
			const escaped = text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
			await run(
				"/usr/bin/osascript",
				["-e", `tell application "System Events" to set frontmost of process "${target}" to true`],
				{ timeout: 2_000 },
			).catch(() => undefined);
			await run(
				"/usr/bin/osascript",
				[
					"-e",
					`tell application "System Events"\nset frontName to name of first process whose frontmost is true\nif frontName is not "${target}" then return\nrepeat with c in "${escaped}"\nset frontName to name of first process whose frontmost is true\nif frontName is not "${target}" then exit repeat\nkeystroke c\ndelay 0.024\nend repeat\nend tell`,
				],
				{ timeout: 30_000 },
			);
			return "Typed.";
		} catch {
			return "Could not type.";
		}
	},
	async keys(combo) {
		if (registered) {
			await rpc("ax.keys", { combo });
			return `Sent ${combo}.`;
		}
		try {
			const { execFile } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const run = promisify(execFile);
			const key = combo.replaceAll('"', "");
			await run(
				"/usr/bin/osascript",
				["-e", `tell application "System Events" to keystroke "${key}"`],
				{ timeout: 2000 },
			);
			return `Sent ${combo}.`;
		} catch {
			return `Could not send ${combo}.`;
		}
	},
	async clickAt(x, y) {
		if (registered) await rpc("ax.clickAt", { x, y });
	},
	async frame(ref) {
		if (!registered) return undefined;
		const result = await rpc<{ x?: number; y?: number; w?: number; h?: number }>("ax.frame", {
			ref,
		});
		if (
			typeof result.x !== "number" ||
			typeof result.y !== "number" ||
			typeof result.w !== "number" ||
			typeof result.h !== "number"
		) {
			return undefined;
		}
		return { x: result.x, y: result.y, w: result.w, h: result.h };
	},
	async windowFrame(app) {
		if (!registered) return undefined;
		const result = await rpc<{ x?: number; y?: number; w?: number; h?: number }>("ax.windowFrame", {
			app,
		});
		if (
			typeof result.x !== "number" ||
			typeof result.y !== "number" ||
			typeof result.w !== "number" ||
			typeof result.h !== "number"
		) {
			return undefined;
		}
		return { x: result.x, y: result.y, w: result.w, h: result.h };
	},
	async status(label) {
		if (registered) await rpc("ui.status", { label });
	},
	async confirm(summary) {
		if (!registered) return "decline";
		const result = await rpc<{ choice?: string; approved?: boolean }>("ui.confirm", { summary });
		if (result.choice === "allow" || result.choice === "decline" || result.choice === "stop") {
			return result.choice;
		}
		return result.approved === true ? "allow" : "decline";
	},
	async choose(summary, buttons) {
		if (!registered) return buttons[1] ?? buttons[0] ?? "";
		const result = await rpc<{ choice?: string }>("ui.choose", { summary, buttons });
		return result.choice ?? buttons[0] ?? "";
	},
	async world() {
		if (!registered) return { text: "", ageMs: 0, sparse: true };
		const result = await rpc<{ text?: string; ageMs?: number; sparse?: boolean; jpeg?: string }>(
			"world.get",
			{},
		);
		return {
			text: result.text ?? "",
			ageMs: result.ageMs ?? 0,
			sparse: result.sparse !== false,
			jpeg: result.jpeg || undefined,
		};
	},
	async takeoverRequest(input) {
		if (!registered) return { skipped: true };
		return rpc("takeover.request", input);
	},
	async takeoverMove(x, y) {
		if (registered) await rpc("takeover.move", { x, y });
	},
	async takeoverClick(x, y) {
		if (registered) await rpc("takeover.click", { x, y });
	},
	async takeoverDrag(from, to) {
		if (registered)
			await rpc("takeover.drag", { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
	},
	async takeoverKey(key) {
		if (registered) await rpc("takeover.key", { key });
	},
	async takeoverType(text) {
		if (registered) await rpc("takeover.type", { text });
	},
	async takeoverEnd() {
		if (registered) await rpc("takeover.end", {});
	},
};
