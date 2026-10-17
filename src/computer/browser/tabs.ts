import { hostOfUrl } from "./applescript-driver.ts";
import { CdpConnection, type CdpTarget, listCdpTargets } from "./cdp.ts";

const MAX_OWNED = 4;

export function pathOf(url: string): string {
	try {
		const parsed = new URL(url.includes("://") ? url : `https://${url}`);
		return parsed.pathname.replace(/\/+$/, "") || "/";
	} catch {
		return "/";
	}
}

/** Reuse a tab on the same host. Never invent a second tab for it. */
export function reuseCandidate(
	pages: readonly { id: string; url: string }[],
	url: string,
): { id: string; url: string } | undefined {
	const host = hostOfUrl(url);
	if (!host) return undefined;
	return pages.find((page) => hostOfUrl(page.url) === host && page.url.startsWith("http"));
}

/** Close the oldest agent-owned tab that is not active, once four are open. */
export function tabToClose(
	owned: readonly string[],
	activeId: string | undefined,
): string | undefined {
	if (owned.length < MAX_OWNED) return undefined;
	return owned.find((id) => id !== activeId);
}

/** The only object allowed to create browser tabs. */
export class BrowserTabs {
	private owned: string[] = [];
	private seen = new Set<string>();
	private connection: CdpConnection | undefined;
	activeId: string | undefined;

	constructor(private port: number) {}

	get page(): CdpConnection | undefined {
		return this.connection;
	}

	async url(): Promise<string> {
		const value = await this.connection?.evaluate<string>("location.href").catch(() => "");
		return value || "";
	}

	async open(url: string): Promise<"reused" | "opened"> {
		await this.adoptPopup();
		const pages = await this.pages();
		const existing = reuseCandidate(pages, url);
		if (existing) {
			await this.activate(existing);
			return "reused";
		}
		const closeId = tabToClose(this.owned, this.activeId);
		if (closeId) await this.closeOwned(closeId);
		const created = await createTab(this.port, url);
		this.owned.push(created.id);
		await this.activate(created);
		return "opened";
	}

	async attachFront(): Promise<void> {
		const pages = await this.pages();
		for (const page of pages) this.seen.add(page.id);
		const front = pages.find((page) => page.url.startsWith("http")) ?? pages[0];
		if (!front) {
			const created = await createTab(this.port, "about:blank");
			this.owned.push(created.id);
			await this.activate(created);
			return;
		}
		await this.activate(front);
	}

	private async adoptPopup(): Promise<void> {
		const pages = await this.pages();
		const fresh = pages.filter((page) => !this.seen.has(page.id) && page.url.startsWith("http"));
		for (const page of pages) this.seen.add(page.id);
		const popup = fresh.find((page) => page.id !== this.activeId);
		if (popup) await this.activate(popup);
	}

	private async pages(): Promise<CdpTarget[]> {
		const targets = await listCdpTargets(this.port);
		return targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
	}

	private async activate(target: {
		id: string;
		url: string;
		webSocketDebuggerUrl?: string;
	}): Promise<void> {
		await fetch(`http://127.0.0.1:${this.port}/json/activate/${target.id}`).catch(() => undefined);
		if (!target.webSocketDebuggerUrl) return;
		if (this.activeId === target.id && this.connection) return;
		this.connection?.close();
		this.connection = await CdpConnection.open(target.webSocketDebuggerUrl);
		await this.connection.send("Runtime.enable");
		await this.connection.send("Page.enable");
		await this.connection.send("Page.setBypassCSP", { enabled: true }).catch(() => undefined);
		await this.connection.send("Page.bringToFront").catch(() => undefined);
		this.activeId = target.id;
		this.seen.add(target.id);
	}

	private async closeOwned(id: string): Promise<void> {
		await fetch(`http://127.0.0.1:${this.port}/json/close/${id}`).catch(() => undefined);
		this.owned = this.owned.filter((item) => item !== id);
	}
}

async function createTab(port: number, url: string): Promise<CdpTarget> {
	const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`);
	if (!res.ok) throw new Error("Could not open a browser tab.");
	return (await res.json()) as CdpTarget;
}
