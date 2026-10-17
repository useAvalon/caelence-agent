import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { checkNavigate, hostsMentioned } from "../../decisions/screen-shortcut.ts";
import { readWebMcpTools } from "../capability.ts";
import {
	documentTitle,
	emptyEditorRef,
	fieldHasNeedle,
	isBrowserChromeField,
	newDocumentRef,
	pageAlreadyHasWriting,
	pageIsBlank,
	pageTopic,
	subjectFitsPage,
	textboxRefFromSnapshot,
	wantsNewDocument,
} from "../compose.ts";
import { nativeBridge } from "../native/client.ts";
import { parseSnapshotLine, refForAction, snapshotLines } from "../snapshot-format.ts";
import {
	activateApp,
	evalBrowserJs,
	focusApp,
	focusBrowserTabByUrl,
	focusedValue,
	frontmostBrowser,
	frontmostProcess,
	frontTabTitle,
	frontTabUrl,
	hostOfUrl,
	listTabUrls,
	openTabInFrontWindow,
	openUrlInApp,
	reuseOrOpenTab,
	runningBrowsers,
	urlListHasHost,
} from "./applescript-driver.ts";
import { attachPage, CdpConnection, listCdpTargets, tryUserChrome } from "./cdp.ts";
import { diffSnapshots } from "./diff.ts";
import { executeOnPage, type PageSnap } from "./executor.ts";
import { typeWithSystemEvents } from "./keyboard.ts";
import { OPEN_COMPOSER_SOURCE, SETTLE_SOURCE } from "./overlay.ts";
import { readSiteNote } from "./repeat.ts";
import { PAGE_RUNTIME, PAGE_RUNTIME_VERSION } from "./runtime.ts";
import { PAGE_SNAPSHOT_SOURCE } from "./snapshot-script.ts";

export type BrowserActionKind =
	| "click"
	| "type"
	| "select"
	| "press"
	| "scroll"
	| "navigate"
	| "click_xy";

export type BrowserActionExpect =
	| "dialog_opens"
	| "focus_inside"
	| "text_equals"
	| "url_changes"
	| "none";

export interface BrowserAction {
	kind: BrowserActionKind;
	ref?: string;
	role?: string;
	name?: string;
	text?: string;
	key?: string;
	url?: string;
	x?: number;
	y?: number;
	label: string;
	risky?: boolean;
	expect?: BrowserActionExpect;
}

interface SnapshotPayload {
	header: string;
	lines: string[];
	boxes: Array<{ ref: string; x: number; y: number; w: number; h: number }>;
}

interface ElementBox {
	x: number;
	y: number;
	w: number;
	h: number;
	screenX: number;
	screenY: number;
}

export class BrowserSession {
	private cdp: CdpConnection | undefined;
	private osaApp: string | undefined;
	private useAx = false;
	private lastSnapshot = "";
	private port = 9222;
	private preferUrl: string | undefined;
	private preferApp: string | undefined;
	private tabReady = false;
	private runId: string | undefined;
	private pageJsFailed = false;
	private cdpPrepared = false;
	private webMcp = "";
	private sentDraft = false;

	draftWasSent(): boolean {
		return this.sentDraft;
	}
	private task = "";
	private seenHosts = new Set<string>();

	setTask(task: string): void {
		this.task = task;
		for (const host of hostsMentioned(task)) this.seenHosts.add(host);
	}

	private postingAway(): boolean {
		return Boolean(this.preferUrl);
	}

	noteHost(url: string): void {
		try {
			const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
			if (host) this.seenHosts.add(host);
		} catch {
			// Not an address.
		}
	}

	setRunId(runId: string): void {
		this.runId = runId;
	}

	async connect(preferUrl?: string, preferApp?: string): Promise<void> {
		if (preferUrl) this.preferUrl = preferUrl;
		if (preferApp) this.preferApp = preferApp;
		if (this.preferApp && this.osaApp && this.osaApp !== this.preferApp) {
			this.cdp?.close();
			this.cdp = undefined;
			this.osaApp = undefined;
			this.useAx = false;
			this.tabReady = false;
		}
		if (!this.osaApp) {
			if (this.preferApp) {
				this.osaApp = this.preferApp;
			} else {
				const front = await frontmostBrowser();
				let running = await runningBrowsers();
				if (!front && !running[0]) {
					openInstalledBrowser();
					await sleep(350);
					running = await runningBrowsers();
				}
				const app = front ?? running[0];
				if (!app) throw new Error("No browser is open.");
				this.osaApp = app;
			}
		}
		if (this.preferUrl) {
			await this.openRequestedPage();
			this.tabReady = true;
		} else if (this.osaApp) {
			await activateApp(this.osaApp);
		}
		this.useAx = true;
		if (this.osaApp === "Google Chrome" || this.osaApp === "Chromium") {
			const port = await tryUserChrome();
			if (port !== undefined) {
				this.port = port;
				this.cdp?.close();
				this.cdp = await attachPage(this.port, this.preferUrl);
				this.useAx = false;
			}
		}
		if (this.cdp) {
			const names = await readWebMcpTools((source) => this.evaluate(source));
			if (names.length > 0) this.webMcp = `WebMCP: ${names.join(", ")}`;
		}
	}

	async snapshot(): Promise<string> {
		if (await this.ensurePageRuntime()) {
			const data = await this.evaluate<PageSnap>("window.__agOps.snap()");
			const text = this.decorate(data.text);
			this.lastSnapshot = text;
			return text;
		}
		if (this.useAx) {
			const text = await nativeBridge.snapshot(this.osaApp);
			this.lastSnapshot = text;
			return text;
		}
		const data = await this.evaluate<SnapshotPayload>(PAGE_SNAPSHOT_SOURCE);
		const text = `${data.header}\n${(data.lines ?? []).join("\n")}`;
		this.lastSnapshot = text;
		return text;
	}

	async settle(): Promise<void> {
		if (this.useAx || this.osaApp) {
			await sleep(50);
			return;
		}
		await this.evaluate(SETTLE_SOURCE);
	}

	async observeAfterAction(): Promise<string> {
		await this.settle();
		const next = await this.snapshot();
		return diffSnapshots(this.lastSnapshot, next);
	}

	async act(actions: readonly BrowserAction[]): Promise<{ observation: string; stopped?: string }> {
		if (await this.ensurePageRuntime()) {
			const result = await executeOnPage(this.pagePort(), actions, {
				runId: this.runId,
				snapshotUsed: this.lastSnapshot,
				navigate: async (url) => {
					await this.navigate(url);
				},
				remember: (text) => {
					this.lastSnapshot = this.decorate(text);
				},
			});
			result.observation = this.decorate(result.observation);
			return result;
		}
		let observation = this.lastSnapshot;
		let lastClick: string | undefined;
		for (const action of actions) {
			if (
				this.creatingNew &&
				isBrowserChromeField(`${action.label} ${action.name ?? ""} ${action.text ?? ""}`)
			) {
				return {
					observation: this.lastSnapshot || (await this.snapshot()),
					stopped:
						"Create a new page from a control on the page. The address bar is not that control.",
				};
			}
			const next =
				action.kind === "type" && !action.ref && lastClick ? { ...action, ref: lastClick } : action;
			try {
				if (next.kind === "navigate" && next.url) {
					observation = await this.navigate(next.url, next.label);
					return { observation };
				}
				await this.perform(next);
				if (next.kind === "click" && next.ref) lastClick = next.ref;
				observation = await this.observeAfterAction();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return { observation, stopped: message };
			}
		}
		return { observation };
	}

	async ensureTab(url: string, preferApp?: string): Promise<"reused" | "opened" | "cdp"> {
		this.preferUrl = url;
		if (preferApp) this.preferApp = preferApp;
		this.tabReady = false;
		await this.connect(url, preferApp);
		this.tabReady = true;
		if (this.cdp && !this.useAx) return "cdp";
		return "reused";
	}

	async attachFrontmost(preferApp?: string): Promise<void> {
		if (preferApp) this.preferApp = preferApp;
		if (this.preferApp) {
			this.osaApp = this.preferApp;
		} else {
			const running = await runningBrowsers();
			const front = await frontmostProcess();
			this.osaApp =
				running.find((name) => name === front) ??
				running.find((name) => name.includes("Chrome") && front.toLowerCase().includes("chrome")) ??
				(await frontmostBrowser()) ??
				running[0];
		}
		if (!this.osaApp) throw new Error("No browser is open.");
		this.useAx = true;
		await focusApp(this.osaApp);
	}

	async currentUrl(): Promise<string> {
		if (!this.osaApp) return "";
		return frontTabUrl(this.osaApp).catch(() => "");
	}

	async focusExistingTab(url: string): Promise<void> {
		if (!this.osaApp || !url) return;
		await focusBrowserTabByUrl(this.osaApp, url).catch(() => undefined);
		await focusApp(this.osaApp);
	}

	async prepareComposer(): Promise<void> {
		await this.openRequestedPage();
		await nativeBridge.pressCompose(this.osaApp);
		await this.openComposerInPage();
	}

	private async openComposerInPage(): Promise<void> {
		const result = await this.evaluate<string>(OPEN_COMPOSER_SOURCE).catch(() => "none");
		if (result === "clicked" || result === "focused") await sleep(180);
	}

	async placeForDraft(request: string): Promise<"blank" | "existing" | "fresh" | "leave"> {
		if (this.postingAway()) return "fresh";
		const rawTitle = this.osaApp ? await frontTabTitle(this.osaApp).catch(() => "") : "";
		if (this.osaApp) {
			const url = await frontTabUrl(this.osaApp).catch(() => "");
			if (url) this.noteHost(url);
		}
		if (pageIsBlank(rawTitle)) return "blank";
		if (wantsNewDocument(request)) {
			this.creatingNew = true;
			const snap = await this.snapshot().catch(() => "");
			return (await this.openNewDocument(snap)) ? "fresh" : "leave";
		}
		const snap = await this.snapshot().catch(() => "");
		const title = documentTitle(rawTitle);
		const topic = title || pageTopic(snap);
		if (!topic || subjectFitsPage(request, topic)) return topic ? "existing" : "fresh";
		this.creatingNew = true;
		if (await this.openNewDocument(snap)) return "fresh";
		return "leave";
	}

	private creatingNew = false;

	private async openNewDocument(snapshot: string): Promise<boolean> {
		let current = snapshot;
		for (let attempt = 0; attempt < 2; attempt++) {
			const created = newDocumentRef(current);
			if (created) {
				await nativeBridge.press(created);
				await sleep(180);
				return true;
			}
			if (attempt === 0) {
				await nativeBridge.keys("pagedown");
				await sleep(120);
				current = await this.snapshot().catch(() => current);
			}
		}
		return false;
	}

	/** Click the page body and type. Does not look for another tab or a new-page control. */
	async typeIntoCurrentPage(text: string): Promise<boolean> {
		const needle = text.trim().slice(0, 24);
		if (!needle) return false;
		if (!this.osaApp) await this.attachFrontmost(this.preferApp);
		if (!this.osaApp) return false;
		await focusApp(this.osaApp);
		if (await this.draftAlreadyThere(text)) return true;
		const result = await nativeBridge.typeText(text, this.osaApp);
		if (result !== "Typed.") return false;
		this.sentDraft = true;
		return this.draftAlreadyThere(text);
	}

	async typeDraft(text: string, options?: { intoExisting?: boolean }): Promise<boolean> {
		const needle = text.trim().slice(0, 24);
		if (!needle) return false;
		if (!this.osaApp) await this.attachFrontmost(this.preferApp);
		if (!this.osaApp) return false;
		await focusApp(this.osaApp);
		if (this.postingAway()) {
			await this.openRequestedPage();
			if (!options?.intoExisting) {
				await nativeBridge.pressCompose(this.osaApp);
				await this.openComposerInPage();
			}
			if (await this.draftAlreadyThere(text)) return true;
			const result = await nativeBridge.typeText(text, this.osaApp);
			if (result !== "Typed.") return false;
			this.sentDraft = true;
			return true;
		}
		const before = await this.snapshot().catch(() => "");
		if (!options?.intoExisting && !textboxRefFromSnapshot(before)) {
			await nativeBridge.pressCompose(this.osaApp);
		}
		if (!this.postingAway() && pageAlreadyHasWriting(before) && !options?.intoExisting) {
			const created = newDocumentRef(before);
			if (!created) return false;
			await nativeBridge.press(created);
			await sleep(180);
			const opened = await this.snapshot().catch(() => "");
			if (pageAlreadyHasWriting(opened)) return false;
		}
		const opened =
			!this.postingAway() && pageAlreadyHasWriting(before) && !options?.intoExisting
				? await this.snapshot().catch(() => before)
				: before;
		const ref = options?.intoExisting
			? (this.contentFieldRef(before) ?? (await this.largestFieldRef(opened)))
			: await this.largestFieldRef(opened);
		if (ref) {
			await nativeBridge.press(ref);
		}
		if (await this.draftAlreadyThere(text)) return true;
		const result = await nativeBridge.typeText(text, this.osaApp);
		if (result !== "Typed.") return false;
		this.sentDraft = true;
		return this.draftAlreadyThere(text);
	}

	private async draftAlreadyThere(text: string): Promise<boolean> {
		const needle = text.trim().slice(0, 24);
		if (!needle || !this.osaApp) return false;
		const focused = await focusedValue(this.osaApp);
		if (focused.includes(needle)) return true;
		const after = await this.snapshot().catch(() => "");
		return fieldHasNeedle(after, needle);
	}

	private async largestFieldRef(snapshot: string): Promise<string | undefined> {
		const candidates = snapshotLines(snapshot)
			.map(parseSnapshotLine)
			.filter((line): line is NonNullable<typeof line> => Boolean(line))
			.filter(
				(line) => line.role === "textbox" && !line.name.trim() && !isBrowserChromeField(line.name),
			)
			.slice(0, 12);
		let best: { ref: string; area: number } | undefined;
		for (const line of candidates) {
			const frame = await nativeBridge.frame(line.ref);
			if (!frame || frame.h < 36 || frame.w < 120) continue;
			const area = frame.w * frame.h;
			if (!best || area > best.area) best = { ref: line.ref, area };
		}
		return best?.ref ?? emptyEditorRef(snapshot);
	}

	private contentFieldRef(snapshot: string): string | undefined {
		const fields = snapshotLines(snapshot)
			.map(parseSnapshotLine)
			.filter((line): line is NonNullable<typeof line> => Boolean(line))
			.filter((line) => line.role === "textbox" && !isBrowserChromeField(line.name));
		fields.sort((a, b) => b.name.length - a.name.length);
		return fields[0]?.ref;
	}

	async composeAndType(text: string): Promise<string> {
		await this.prepareComposer();
		if (text) {
			await this.typeDraft(text);
			return "# typed";
		}
		return "# composer open";
	}

	async navigate(url: string, _label = "navigate"): Promise<string> {
		const gate = checkNavigate(url, { task: this.task, seenHosts: this.seenHosts });
		if (!gate.ok) return gate.message;
		this.noteHost(url);
		const host = hostOfUrl(url);
		if (this.osaApp && host && (await this.hostIsOpen(host))) {
			await focusBrowserTabByUrl(this.osaApp, host).catch(() => undefined);
			await focusApp(this.osaApp);
			this.tabReady = true;
			this.preferUrl = url;
			const snap = await this.snapshot();
			return `Already on ${host}. Current state below.\n${snap}`;
		}
		if (this.tabReady && this.preferUrl && host === hostOfUrl(this.preferUrl)) {
			const snap = await this.snapshot();
			return `Already on ${host}. Current state below.\n${snap}`;
		}
		this.preferUrl = url;
		if (this.osaApp || this.useAx) {
			if (this.osaApp) await this.attachSite(url);
			this.tabReady = true;
			await this.settle();
			return await this.snapshot();
		}
		const page = this.requirePage();
		const origin = originOf(url);
		if (origin) {
			const reused = await this.reuseTab(origin);
			if (reused) {
				this.cdp = reused;
				return await this.snapshot();
			}
		}
		await page.send("Page.navigate", { url });
		await this.settle();
		return await this.snapshot();
	}

	async listTabs(): Promise<Array<{ title: string; url: string }>> {
		if (this.osaApp) return [];
		const targets = await listCdpTargets(this.port);
		return targets
			.filter((item) => item.type === "page")
			.map((item) => ({ title: item.title, url: item.url }));
	}

	close(): void {
		this.cdp?.close();
		this.cdp = undefined;
		this.osaApp = undefined;
		this.preferApp = undefined;
		this.useAx = false;
		this.tabReady = false;
		this.pageJsFailed = false;
		this.cdpPrepared = false;
	}

	private requirePage(): CdpConnection {
		if (!this.cdp) throw new Error("No browser is attached.");
		return this.cdp;
	}

	private async attachSite(url: string): Promise<"reused" | "opened"> {
		if (!this.osaApp) return "opened";
		if (this.postingAway()) {
			const front = await frontTabUrl(this.osaApp).catch(() => "");
			if (front && urlListHasHost(front, hostOfUrl(url))) return "reused";
			await openTabInFrontWindow(this.osaApp, url);
			return "opened";
		}
		return reuseOrOpenTab(this.osaApp, url, url);
	}

	/** Open the asked site in the asked browser. Do not click until that page is front. */
	private async openRequestedPage(): Promise<boolean> {
		if (!this.osaApp) return false;
		if (!this.preferUrl) {
			await focusApp(this.osaApp);
			return true;
		}
		const host = hostOfUrl(this.preferUrl);
		const front = await frontTabUrl(this.osaApp).catch(() => "");
		if (front && urlListHasHost(front, host)) {
			await focusApp(this.osaApp);
			return true;
		}
		if (this.postingAway()) {
			await openTabInFrontWindow(this.osaApp, this.preferUrl);
			if (!(await this.waitForHost(host, 6))) await sleep(200);
			await focusApp(this.osaApp);
			return true;
		}
		if (await this.hostIsOpen(host)) {
			await focusBrowserTabByUrl(this.osaApp, host).catch(() => undefined);
			await focusApp(this.osaApp);
			return true;
		}
		await focusBrowserTabByUrl(this.osaApp, host).catch(() => undefined);
		if (await this.waitForHost(host, 3)) {
			await focusApp(this.osaApp);
			return true;
		}
		await openTabInFrontWindow(this.osaApp, this.preferUrl).catch(() =>
			openUrlInApp(this.osaApp ?? "", this.preferUrl ?? ""),
		);
		if (!(await this.waitForHost(host, 6))) await sleep(200);
		await focusApp(this.osaApp);
		return true;
	}

	private async hostIsOpen(host: string): Promise<boolean> {
		if (!this.osaApp || !host) return false;
		const front = await frontTabUrl(this.osaApp).catch(() => "");
		if (urlListHasHost(front, host)) return true;
		const listed = await listTabUrls(this.osaApp).catch(() => "");
		return urlListHasHost(listed, host);
	}

	private async waitForHost(host: string, attempts: number): Promise<boolean> {
		if (!this.osaApp) return false;
		for (let i = 0; i < attempts; i++) {
			const front = await frontTabUrl(this.osaApp);
			if (urlListHasHost(front, host)) return true;
			await sleep(120);
		}
		return false;
	}

	private async evaluate<T>(expression: string): Promise<T> {
		if (this.cdp) return this.cdp.evaluate<T>(expression);
		if (this.osaApp) return evalBrowserJs<T>(this.osaApp, expression);
		return this.requirePage().evaluate<T>(expression);
	}

	private decorate(text: string): string {
		const url = text.split("\n").find((line) => line.startsWith("URL")) ?? "";
		const note = readSiteNote(url.replace(/^URL:\s*/, "").replace(/^URL\s+/, ""));
		const withMcp = this.webMcp ? `${this.webMcp}\n${text}` : text;
		return note ? `SITE\n${note}\n${withMcp}` : withMcp;
	}

	private async ensurePageRuntime(): Promise<boolean> {
		if (this.pageJsFailed) return false;
		if (!this.cdp && !this.osaApp) return false;
		try {
			if (this.cdp && !this.cdpPrepared) {
				await this.cdp
					.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_RUNTIME })
					.catch(() => undefined);
				await this.cdp.send("Page.setBypassCSP", { enabled: true }).catch(() => undefined);
				this.cdpPrepared = true;
			}
			const version = await this.evaluate<number>("window.__ag && window.__ag.version");
			if (version !== PAGE_RUNTIME_VERSION) await this.evaluate(PAGE_RUNTIME);
			this.useAx = false;
			return true;
		} catch {
			if (!this.cdp) this.pageJsFailed = true;
			return false;
		}
	}

	private pagePort() {
		const cdp = this.cdp;
		const app = this.osaApp;
		return {
			evaluate: <T>(expression: string) => this.evaluate<T>(expression),
			clickAt: cdp ? (x: number, y: number) => cdp.mouseClick(x, y) : undefined,
			typeChars: cdp
				? (text: string) => cdp.typeChars(text)
				: (text: string) => typeWithSystemEvents(text, app),
			insertText: cdp ? (text: string) => cdp.insertText(text) : undefined,
			press: cdp
				? (key: "Enter" | "Escape" | "Backspace" | "Space") => cdp.pressKey(key)
				: async (key: "Enter" | "Escape" | "Backspace" | "Space") => {
						await nativeBridge.keys(key.toLowerCase());
					},
			screenshot: cdp
				? async (file: string) => {
						await writeFile(file, await cdp.screenshotPng());
					}
				: undefined,
			reinject: async () => {
				await this.evaluate(PAGE_RUNTIME);
			},
			windowOrigin: cdp ? () => cdp.windowOrigin() : undefined,
		};
	}

	private async reuseTab(origin: string): Promise<CdpConnection | undefined> {
		const targets = (await listCdpTargets(this.port)).filter(
			(item) => item.type === "page" && item.url.startsWith(origin) && item.webSocketDebuggerUrl,
		);
		const hit = targets[0];
		if (!hit?.webSocketDebuggerUrl) return undefined;
		this.cdp?.close();
		const next = await CdpConnection.open(hit.webSocketDebuggerUrl);
		await next.send("Runtime.enable");
		await next.send("Page.enable");
		await next.send("Page.bringToFront").catch(() => undefined);
		return next;
	}

	private async perform(action: BrowserAction): Promise<void> {
		if (this.useAx) {
			await this.performAx(action);
			return;
		}
		if (action.kind === "click_xy") {
			const x = action.x ?? 0;
			const y = action.y ?? 0;
			await this.evaluate(
				`document.elementFromPoint(${x},${y})?.dispatchEvent(new MouseEvent("click",{bubbles:true}))`,
			);
			return;
		}
		if (action.kind === "press" && action.key) {
			await this.evaluate(
				`document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:${JSON.stringify(action.key)},bubbles:true}))`,
			);
			return;
		}
		if (action.kind === "scroll") {
			await this.evaluate("window.scrollBy(0, Math.floor(innerHeight * 0.7))");
			return;
		}
		const ref = action.ref;
		if (!ref) throw new Error("Action is missing a ref.");
		const box = await this.elementBox(ref);
		if (!box) throw new Error(`Unknown ref ${ref}. Take a fresh observe.`);
		if (action.kind === "click") {
			await this.evaluate(
				`(() => { document.querySelector('[data-ag=${JSON.stringify(ref)}]')?.click(); })()`,
			);
			return;
		}
		if (action.kind === "type" && action.text !== undefined) {
			await this.evaluate(
				`(() => { const el = document.querySelector('[data-ag=${JSON.stringify(ref)}]'); el?.focus(); el?.click(); })()`,
			);
			await nativeBridge.typeText(action.text, this.osaApp);
			return;
		}
		if (action.kind === "select" && action.text) {
			await this.evaluate(
				`(() => { const el = document.querySelector('[data-ag=${JSON.stringify(ref)}]'); if (el && "value" in el) { el.value = ${JSON.stringify(action.text)}; el.dispatchEvent(new Event("change", { bubbles: true })); } })()`,
			);
		}
	}

	private async performAx(action: BrowserAction): Promise<void> {
		if (action.kind === "scroll") {
			await nativeBridge.keys("pagedown");
			return;
		}
		if (action.kind === "press" && action.key) {
			await nativeBridge.keys(action.key);
			return;
		}
		if (action.kind === "click_xy") {
			const x = action.x ?? 0;
			const y = action.y ?? 0;
			await nativeBridge.clickAt(x, y);
			return;
		}
		const ref = action.ref
			? (refForAction(this.lastSnapshot, action) ?? action.ref)
			: refForAction(this.lastSnapshot, action);
		const name =
			action.name ||
			(action.kind !== "type" && action.kind !== "select" && action.label !== action.kind
				? action.label
				: undefined);
		if (action.kind === "click" || action.kind === "type" || action.kind === "select") {
			if (ref) {
				await nativeBridge.press(ref);
			} else if (name && action.kind !== "type" && action.kind !== "select") {
				const pressed = await nativeBridge.pressName(name);
				if (!pressed.startsWith("Pressed")) throw new Error(pressed);
			} else if (action.kind !== "type" && action.kind !== "select") {
				throw new Error(
					ref ? `Unknown ref ${ref}. Take a fresh observe.` : "Action is missing a ref.",
				);
			}
			if (action.kind === "click") return;
			await sleep(40);
			if (action.text && fieldHasNeedle(this.lastSnapshot, action.text.slice(0, 24))) return;
			const typed = await nativeBridge.typeText(action.text ?? "", this.osaApp);
			if (typed !== "Typed.") throw new Error(typed);
		}
	}

	private async elementBox(ref: string): Promise<ElementBox | null> {
		return this.evaluate<ElementBox | null>(
			`(() => {
        const el = document.querySelector('[data-ag=${JSON.stringify(ref)}]');
        if (!el) return null;
        el.scrollIntoView({block:"center", inline:"nearest"});
        const r = el.getBoundingClientRect();
        const chrome = Math.max(0, window.outerHeight - window.innerHeight);
        return {
          x: r.x, y: r.y, w: r.width, h: r.height,
          screenX: Math.round(window.screenX + r.left + r.width / 2),
          screenY: Math.round(window.screenY + chrome + r.top + r.height / 2)
        };
      })()`,
		);
	}
}

function originOf(url: string): string | undefined {
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function openInstalledBrowser(): void {
	const app = existsSync("/Applications/Arc.app")
		? "Arc"
		: existsSync("/Applications/Google Chrome.app")
			? "Google Chrome"
			: undefined;
	if (!app) return;
	spawn("/usr/bin/open", ["-a", app], { detached: true, stdio: "ignore" }).unref();
}
