import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runsDir } from "../telemetry.ts";
import { laterActionsUseRefs, normField, signatureChanged } from "./batch.ts";
import {
	FocusError,
	hintFor,
	NotHittableError,
	PostconditionError,
	StaleRefError,
} from "./errors.ts";
import { recordFailure } from "./failures.ts";
import type { BrowserAction } from "./session.ts";

export interface MeasuredTarget {
	ok: boolean;
	code?: string;
	message?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	screenX: number;
	screenY: number;
	role: string;
	name: string;
	hittable: boolean;
	focused: boolean;
}

export interface PageSnap {
	text: string;
	meta: Record<string, { role: string; name: string }>;
	count: number;
	modal: boolean;
	url: string;
	focused: boolean;
	skipped?: Array<{ reason: string; role: string; name: string }>;
}

export interface PagePort {
	evaluate<T>(expression: string): Promise<T>;
	clickAt?(x: number, y: number): Promise<void>;
	typeChars?(text: string): Promise<void>;
	insertText?(text: string): Promise<void>;
	press?(key: "Enter" | "Escape" | "Backspace" | "Space"): Promise<void>;
	screenshot?(file: string): Promise<void>;
	reinject?(): Promise<void>;
	windowOrigin?(): Promise<{ x: number; y: number } | undefined>;
}

export interface ExecuteOptions {
	runId?: string;
	snapshotUsed?: string;
	navigate?: (url: string) => Promise<void>;
	moveCursor?: (x: number, y: number, label?: string) => Promise<void>;
	stableMs?: number;
	remember?: (snapshot: string) => void;
}

const VISIBLE_LIMIT = 300;

function call(name: string, arg?: unknown): string {
	if (arg === undefined) return `window.__agOps.${name}()`;
	return `window.__agOps.${name}(${JSON.stringify(arg)})`;
}

function targetOf(action: BrowserAction): { ref?: string; role?: string; name?: string } {
	return { ref: action.ref, role: action.role, name: action.name };
}

function logAction(runId: string | undefined, entry: object): void {
	try {
		const dir = join(runsDir(), runId || "browser");
		mkdirSync(dir, { recursive: true });
		appendFileSync(
			join(dir, "actions.jsonl"),
			`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
		);
	} catch {
		// Local log only.
	}
}

async function ensureOverlay(port: PagePort): Promise<void> {
	const health = await port
		.evaluate<{ connected?: boolean; w?: number }>(
			"window.__ag && window.__ag.health && window.__ag.health()",
		)
		.catch(() => undefined);
	if (!health?.connected || (health.w ?? 0) < 2) await port.reinject?.();
}

async function snap(port: PagePort, remember?: (snapshot: string) => void): Promise<PageSnap> {
	const raw = await port.evaluate<PageSnap>(call("snap"));
	let text = raw.text;
	if (raw.count < 3) {
		text = `${text}\nSNAPSHOT THIN: few interactive elements were visible.`;
	}
	remember?.(text);
	return { ...raw, text };
}

async function measure(
	port: PagePort,
	action: BrowserAction,
	scroll: boolean,
): Promise<MeasuredTarget> {
	const raw = await port.evaluate<MeasuredTarget>(
		`window.__agOps.measure(${JSON.stringify(targetOf(action))}, ${scroll ? "true" : "false"})`,
	);
	if (!raw || raw.code === "stale") {
		throw new StaleRefError(raw?.message || `Could not find "${action.label}".`);
	}
	if (!port.windowOrigin) return raw;
	const origin = await port.windowOrigin();
	if (!origin) return raw;
	return {
		...raw,
		screenX: Math.round(origin.x + raw.x + raw.width / 2),
		screenY: Math.round(origin.y + raw.y + raw.height / 2),
	};
}

function closeEnough(a: MeasuredTarget, b: MeasuredTarget): boolean {
	return (
		Math.abs(a.x - b.x) < 1 &&
		Math.abs(a.y - b.y) < 1 &&
		Math.abs(a.width - b.width) < 1 &&
		Math.abs(a.height - b.height) < 1 &&
		a.width > 0
	);
}

async function stableMeasure(
	port: PagePort,
	action: BrowserAction,
	stableMs: number,
): Promise<MeasuredTarget> {
	await port.evaluate(call("finishMotion")).catch(() => undefined);
	let current = await measure(port, action, true);
	if (stableMs > 0) {
		const start = Date.now();
		let previous = current;
		while (Date.now() - start < stableMs) {
			await sleep(32);
			current = await measure(port, action, false);
			if (closeEnough(previous, current)) break;
			previous = current;
		}
	}
	if (current.width < 2 || current.height < 2) {
		throw new StaleRefError(current.message || `"${action.label}" has no size.`);
	}
	return current;
}

async function aim(
	port: PagePort,
	action: BrowserAction,
	options: ExecuteOptions,
): Promise<MeasuredTarget> {
	return stableMeasure(port, action, options.stableMs ?? 1000);
}

async function visibleClick(
	port: PagePort,
	action: BrowserAction,
	options: ExecuteOptions,
): Promise<string> {
	let rect = await aim(port, action, options);
	const method = await clickResolved(port, action, rect);
	if (method) return method;
	await port.evaluate(call("dismissBlockers"));
	rect = await aim(port, action, { ...options, stableMs: Math.min(options.stableMs ?? 300, 300) });
	const retried = await clickResolved(port, action, rect);
	if (retried) return retried === "click" ? "click-after-dismiss" : retried;
	if (["button", "link", "a", "menuitem", "tab"].includes(rect.role)) {
		const focused = await port.evaluate<{ ok?: boolean }>(call("focus", targetOf(action)));
		if (focused?.ok === false) {
			throw new NotHittableError(`"${action.label}": target is covered and cannot be clicked.`);
		}
		if (port.press) await port.press("Enter");
		else await port.evaluate(call("clickElement", targetOf(action)));
		return "keyboard";
	}
	throw new NotHittableError(`"${action.label}": target is covered and cannot be clicked.`);
}

async function clickResolved(
	port: PagePort,
	action: BrowserAction,
	rect: MeasuredTarget,
): Promise<string | undefined> {
	if (!rect.hittable) return undefined;
	if (port.clickAt) {
		await port.clickAt(rect.x + rect.width / 2, rect.y + rect.height / 2);
		return "click";
	}
	const clicked = await port.evaluate<{ ok?: boolean; code?: string }>(
		call("clickElement", targetOf(action)),
	);
	if (clicked?.ok) return "click";
	if (clicked?.code === "stale")
		throw new StaleRefError(`"${action.label}" disappeared before the click.`);
	return undefined;
}

async function ensureFocus(port: PagePort, action: BrowserAction): Promise<void> {
	const state = await port.evaluate<{ inside?: boolean }>(call("focusState", targetOf(action)));
	if (state?.inside) return;
	const focused = await port.evaluate<{ ok?: boolean }>(call("focus", targetOf(action)));
	if (!focused?.ok) throw new FocusError("Could not focus the target field.");
}

async function typeText(
	port: PagePort,
	action: BrowserAction,
	options: ExecuteOptions,
): Promise<string> {
	const text = action.text ?? "";
	await visibleClick(port, action, options);
	await ensureFocus(port, action);
	const cleared = await port.evaluate<{ ok?: boolean; code?: string }>(
		call("clear", targetOf(action)),
	);
	if (cleared?.code === "focus") throw new FocusError("Could not focus the target field.");
	await writeText(port, action, text);
	await closeTypeahead(port, text);
	if (normField(await readField(port, action)) === normField(text)) return "type";
	await ensureFocus(port, action);
	await port.evaluate(call("clear", targetOf(action)));
	await insertAll(port, action, text);
	const actual = await readField(port, action);
	if (normField(actual) !== normField(text)) {
		throw new PostconditionError(
			`Text mismatch after retry. Field contains: "${normField(actual).slice(0, 120)}"`,
		);
	}
	return "type-retry";
}

async function writeText(port: PagePort, action: BrowserAction, text: string): Promise<void> {
	if (text.length <= VISIBLE_LIMIT) {
		await typeVisible(port, action, text);
		return;
	}
	const cut = text.slice(0, VISIBLE_LIMIT).lastIndexOf(" ");
	const head = text.slice(0, cut > 0 ? cut : VISIBLE_LIMIT);
	await typeVisible(port, action, head);
	await insertAll(port, action, text.slice(head.length));
}

async function typeVisible(port: PagePort, action: BrowserAction, text: string): Promise<void> {
	if (port.typeChars) {
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (i > 0 && port.press) await port.press("Enter");
			if (lines[i]) await port.typeChars(lines[i] ?? "");
		}
		return;
	}
	await insertAll(port, action, text);
}

async function insertAll(port: PagePort, action: BrowserAction, text: string): Promise<void> {
	if (!text) return;
	if (port.insertText) {
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (i > 0 && port.press) await port.press("Enter");
			if (lines[i]) await port.insertText(lines[i] ?? "");
		}
		return;
	}
	await port.evaluate(
		`window.__agOps.insert(${JSON.stringify(targetOf(action))}, ${JSON.stringify(text)})`,
	);
}

async function readField(port: PagePort, action: BrowserAction): Promise<string> {
	return (await port.evaluate<string>(call("read", targetOf(action)))) ?? "";
}

async function closeTypeahead(port: PagePort, text: string): Promise<void> {
	if (!/[#@]/.test(text)) return;
	const open = await port.evaluate<boolean>(call("typeahead"));
	if (!open) return;
	const before = await port.evaluate<number>(call("modalCount"));
	if (port.press) await port.press("Escape");
	const after = await port.evaluate<number>(call("modalCount"));
	if (after < before) {
		throw new PostconditionError("Escape closed the composer while dismissing suggestions.");
	}
}

async function checkExpect(
	action: BrowserAction,
	before: PageSnap,
	after: PageSnap,
): Promise<void> {
	const expect = action.expect ?? (action.kind === "type" ? "text_equals" : "none");
	if (expect === "dialog_opens" && !after.modal) {
		throw new PostconditionError("Expected a dialog to open, none is open.");
	}
	if (expect === "focus_inside" && !after.focused) {
		throw new PostconditionError("No field has focus after the click.");
	}
	if (expect === "url_changes" && after.url === before.url) {
		throw new PostconditionError("URL did not change.");
	}
}

export async function executeOnPage(
	port: PagePort,
	actions: readonly BrowserAction[],
	options: ExecuteOptions = {},
): Promise<{ observation: string; stopped?: string }> {
	let before = await snap(port, options.remember);
	let used = options.snapshotUsed ?? before.text;
	for (const [index, action] of actions.entries()) {
		const started = Date.now();
		try {
			await ensureOverlay(port);
			let method: string = action.kind;
			if (action.kind === "navigate" && action.url) {
				if (!options.navigate) throw new Error("Navigate is not available.");
				await options.navigate(action.url);
			} else if (action.kind === "press" && action.key) {
				if (port.press && ["Enter", "Escape", "Backspace", "Space"].includes(action.key)) {
					await port.press(action.key as "Enter" | "Escape" | "Backspace" | "Space");
				} else {
					await port.evaluate(
						`document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:${JSON.stringify(action.key)},bubbles:true}))`,
					);
				}
			} else if (action.kind === "scroll") {
				await port.evaluate("window.scrollBy(0, Math.floor(innerHeight * 0.7))");
			} else if (action.kind === "click_xy") {
				const x = action.x ?? 0;
				const y = action.y ?? 0;
				if (port.clickAt) await port.clickAt(x, y);
				else {
					await port.evaluate(
						`document.elementFromPoint(${x},${y}) && document.elementFromPoint(${x},${y}).click()`,
					);
				}
			} else if (action.kind === "click" || action.kind === "select") {
				method = await visibleClick(port, action, options);
				if (action.kind === "select" && action.text) {
					await ensureFocus(port, action);
					await port.evaluate(call("clear", targetOf(action)));
					await insertAll(port, action, action.text);
				}
			} else if (action.kind === "type") {
				method = await typeText(port, action, options);
			}
			await port.evaluate(call("finishMotion")).catch(() => undefined);
			await port
				.evaluate(
					`new Promise((resolve) => { let timer; const done = () => { observer.disconnect(); resolve("settled"); }; const bump = () => { clearTimeout(timer); timer = setTimeout(done, 180); }; const observer = new MutationObserver(bump); bump(); observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true }); setTimeout(done, 700); })`,
				)
				.catch(() => undefined);
			if ((options.stableMs ?? 1) > 0) await sleep(160);
			const after = await snap(port, options.remember);
			await checkExpect(action, before, after);
			logAction(options.runId, {
				i: index,
				kind: action.kind,
				label: action.label,
				method,
				ms: Date.now() - started,
				postcondition: action.expect ?? "none",
			});
			if (signatureChanged(before, after) && laterActionsUseRefs(actions, index)) {
				const left = actions.length - index - 1;
				return {
					observation: `Page changed after action ${index} ("${action.label}"). Remaining ${left} actions skipped. Use these refs:\n${after.text}`,
				};
			}
			before = after;
			used = after.text;
		} catch (err) {
			const fresh = await snap(port, options.remember).catch(() => before);
			const diagnostics = await port
				.evaluate(call("diagnostics", targetOf(action)))
				.catch((failure: unknown) => ({ evalError: String(failure) }));
			await recordFailure({
				runId: options.runId,
				action,
				error: err,
				url: fresh.url,
				snapshotUsed: used,
				freshSnapshot: fresh.text,
				diagnostics,
				screenshot: port.screenshot
					? (file) => port.screenshot?.(file) ?? Promise.resolve()
					: undefined,
			});
			logAction(options.runId, {
				i: index,
				kind: action.kind,
				label: action.label,
				method: "failed",
				ms: Date.now() - started,
				postcondition: "failed",
			});
			const message = err instanceof Error ? err.message : String(err);
			return {
				observation: `Action ${index} ("${action.label}") failed: ${message}\nHint: ${hintFor(err)}\n${fresh.text}`,
				stopped: message,
			};
		}
	}
	return { observation: before.text };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
