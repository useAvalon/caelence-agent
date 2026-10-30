import { describe, expect, test } from "bun:test";
import { type McpToolDefinition, textResult, UNKNOWN_TOOL_ANNOTATIONS } from "../core/mcp.ts";
import {
	BROWSER_APPS,
	CHROME_NOT_READY,
	createOwnChromeGuard,
	hostsInText,
	liveTarget,
	NOT_READY_ENDPOINT,
	nodeSearchDirs,
	notReadyMessage,
	ownChromeServerOptions,
	PLAYWRIGHT_MCP_VERSION,
	portAnswers,
	readDevToolsEndpoint,
	resolveNpx,
	resolveTarget,
	startOwnChromeTools,
} from "./own-chrome.ts";

/** A snapshot in the exact shape Playwright MCP returns, captured from a real run. */
const PAGE = (url: string) => `### Open tabs
- 0: (current) [Test side](${url})
### Page
- Page URL: ${url}
- Page Title: Test side
### Snapshot
\`\`\`yaml
- generic [active] [ref=e1]:
  - heading "Skriv et opslag" [level=1] [ref=e2]
  - textbox "Hvad sker der?" [ref=e3]
  - searchbox "Søg" [ref=e4]
  - button "Gem kladde" [ref=e5]
  - button "Slå op" [ref=e6]
  - button "Annuller" [ref=e7]
  - link "Andet link" [ref=e8] [cursor=pointer]:
    - /url: /other
\`\`\``;

function fake(name: string, reply: (input: Record<string, unknown>) => string | Error) {
	const calls: Array<Record<string, unknown>> = [];
	const tool: McpToolDefinition = {
		name: `browser__${name}`,
		description: name,
		inputSchema: { type: "object", properties: {} },
		annotations: UNKNOWN_TOOL_ANNOTATIONS,
		async handler(input) {
			calls.push(input);
			const out = reply(input);
			return out instanceof Error ? textResult(out.message, true) : textResult(out);
		},
	};
	return { tool, calls };
}

function setup(trusted: string[] = ["x.com"]) {
	const url = { current: "https://x.com/" };
	const names = [
		"browser_navigate",
		"browser_tabs",
		"browser_snapshot",
		"browser_click",
		"browser_type",
		"browser_fill_form",
		"browser_press_key",
		"browser_handle_dialog",
		"browser_evaluate",
		"browser_run_code_unsafe",
		"browser_file_upload",
		"browser_network_requests",
		"browser_close",
	];
	// Playwright MCP returns a full snapshot only for some tools. A click or a keystroke returns
	// just the code it ran, with no refs, and the guard must keep the refs from the last snapshot.
	const ACTS = new Set(["browser_click", "browser_type", "browser_fill_form", "browser_press_key"]);
	const RAN = "### Ran Playwright code\n```js\nawait page.getByRole('textbox').fill('x');\n```";
	const made = Object.fromEntries(
		names.map((n) => [
			n,
			fake(n, (input) => {
				if (typeof input.url === "string") url.current = input.url;
				return ACTS.has(n) ? RAN : PAGE(url.current);
			}),
		]),
	);
	const guard = createOwnChromeGuard();
	guard.trust(trusted);
	const wrapped = guard.tools(Object.values(made).map((m) => m.tool));
	const by = (n: string) => wrapped.find((t) => t.name === `browser__${n}`);
	return { guard, wrapped, made, by };
}

const call = (t: McpToolDefinition | undefined, input: Record<string, unknown>) => {
	if (!t) throw new Error("tool missing");
	return t.handler(input);
};

describe("tool allowlist", () => {
	test("offers the page tools and none that run code, upload files, or read traffic", () => {
		const { wrapped } = setup();
		const names = wrapped.map((t) => t.name.replace("browser__", ""));
		expect(names).toContain("browser_click");
		expect(names).toContain("browser_snapshot");
		for (const banned of [
			"browser_evaluate",
			"browser_run_code_unsafe",
			"browser_file_upload",
			"browser_network_requests",
			"browser_close",
		]) {
			expect(names).not.toContain(banned);
		}
	});
});

describe("own tab", () => {
	test("navigate is refused until the agent has opened a tab of its own", async () => {
		const { by, made } = setup();
		const res = await call(by("browser_navigate"), { url: "https://x.com/home" });
		expect(res.isError).toBe(true);
		expect(res.content[0]?.text).toContain("browser_tabs action=new");
		expect(made.browser_navigate?.calls).toHaveLength(0);
	});

	test("after opening its own tab, navigation works", async () => {
		const { by, made } = setup();
		await call(by("browser_tabs"), { action: "new", url: "https://x.com/" });
		const res = await call(by("browser_navigate"), { url: "https://x.com/home" });
		expect(res.isError).toBeFalsy();
		expect(made.browser_navigate?.calls).toHaveLength(1);
	});

	test("closing and switching the user's tabs is refused", async () => {
		const { by, made } = setup();
		for (const action of ["close", "select"]) {
			const res = await call(by("browser_tabs"), { action, index: 0 });
			expect(res.isError).toBe(true);
		}
		expect(made.browser_tabs?.calls).toHaveLength(0);
		expect((await call(by("browser_tabs"), { action: "list" })).isError).toBeFalsy();
	});
});

describe("opening sites", () => {
	test("a site the user named does not ask, including its subdomains", () => {
		const { by } = setup(["x.com"]);
		expect(
			by("browser_tabs")?.confirm?.({ action: "new", url: "https://x.com/compose/post" }),
		).toBeUndefined();
		expect(
			by("browser_tabs")?.confirm?.({ action: "new", url: "https://www.x.com/" }),
		).toBeUndefined();
		expect(
			by("browser_tabs")?.confirm?.({ action: "new", url: "https://api.x.com/" }),
		).toBeUndefined();
	});

	test("any other site asks first, and names it", async () => {
		const { by } = setup(["x.com"]);
		const reason = by("browser_tabs")?.confirm?.({
			action: "new",
			url: "https://mybank.example/login",
		});
		expect(reason).toContain("mybank.example");
		// navigate asks too once there is an own tab
		await call(by("browser_tabs"), { action: "new", url: "https://x.com/" });
		expect(by("browser_navigate")?.confirm?.({ url: "https://evil.example/" })).toContain(
			"evil.example",
		);
	});

	test("a look-alike host is not covered by a trusted one", () => {
		const { by } = setup(["x.com"]);
		expect(
			by("browser_tabs")?.confirm?.({ action: "new", url: "https://notx.com/" }),
		).toBeDefined();
		expect(
			by("browser_tabs")?.confirm?.({ action: "new", url: "https://x.com.evil.example/" }),
		).toBeDefined();
	});

	test("once the user approves a site, later opens of it do not ask again", async () => {
		const { by } = setup(["x.com"]);
		expect(
			by("browser_tabs")?.confirm?.({ action: "new", url: "https://github.com/" }),
		).toBeDefined();
		await call(by("browser_tabs"), { action: "new", url: "https://github.com/" });
		expect(
			by("browser_tabs")?.confirm?.({ action: "new", url: "https://github.com/pulls" }),
		).toBeUndefined();
	});

	test("a refused open is not remembered", async () => {
		const { by } = setup(["x.com"]);
		// The gate refused, so the handler never ran. The site must still ask next time.
		expect(
			by("browser_tabs")?.confirm?.({ action: "new", url: "https://github.com/" }),
		).toBeDefined();
		expect(
			by("browser_tabs")?.confirm?.({ action: "new", url: "https://github.com/" }),
		).toBeDefined();
	});
});

describe("clicks that commit", () => {
	async function onPage() {
		const ctx = setup(["x.com"]);
		await call(ctx.by("browser_tabs"), { action: "new", url: "https://x.com/" });
		await call(ctx.by("browser_snapshot"), {});
		return ctx;
	}

	test("a button that names a commit asks, in English and Danish", async () => {
		const { by } = await onPage();
		// e6 is "Slå op" (Danish for post) on the real snapshot above.
		expect(by("browser_click")?.confirm?.({ element: "Slå op button", target: "e6" })).toContain(
			"Slå op",
		);
		// English wording in the model's description of an element the page does not label.
		expect(by("browser_click")?.confirm?.({ element: "Post button", target: "eX" })).toContain(
			"Post",
		);
	});

	test("the approval shows the page's own label, even when the model describes it differently", async () => {
		const { by } = await onPage();
		// The model says "Post button" but ref e5 is really "Gem kladde". The user must see the truth.
		const reason = by("browser_click")?.confirm?.({ element: "Post button", target: "e5" });
		expect(reason).toContain("Gem kladde");
		expect(reason).not.toContain("Post button");
	});

	test("a harmless click does not ask", async () => {
		const { by } = await onPage();
		expect(by("browser_click")?.confirm?.({ element: "Gem kladde", target: "e5" })).toBeUndefined();
		expect(by("browser_click")?.confirm?.({ element: "Annuller", target: "e7" })).toBeUndefined();
		expect(by("browser_click")?.confirm?.({ element: "link", target: "e8" })).toBeUndefined();
	});

	test("commit words match whole words only", async () => {
		const { by } = await onPage();
		expect(
			by("browser_click")?.confirm?.({ element: "Postcode field", target: "eX" }),
		).toBeUndefined();
		expect(
			by("browser_click")?.confirm?.({ element: "Compost guide", target: "eX" }),
		).toBeUndefined();
	});

	test("after typing, any button asks, whatever language it is in", async () => {
		const { by } = await onPage();
		await call(by("browser_type"), { target: "e3", text: "hello" });
		// "Gem kladde" (save draft) asks too: the rule does not read words
		expect(by("browser_click")?.confirm?.({ element: "x", target: "e5" })).toContain("Gem kladde");
		expect(by("browser_click")?.confirm?.({ element: "x", target: "e7" })).toContain("Annuller");
	});

	test("the page's labels survive a type call that returns no snapshot", async () => {
		const { by } = await onPage();
		await call(by("browser_type"), { target: "e3", text: "hello" });
		await call(by("browser_click"), { target: "e4" });
		// e6 was read from the snapshot before typing. A type and a click later it must still resolve.
		expect(by("browser_click")?.confirm?.({ element: "knap", target: "e6" })).toContain("Slå op");
	});

	test("refs from before a navigation are forgotten", async () => {
		const guard = createOwnChromeGuard();
		guard.trust(["x.com"]);
		// Navigation that returns no snapshot, as a back or a redirect might.
		const nav = fake("browser_navigate", () => "### Result\nNavigated");
		const tabs = fake("browser_tabs", () => PAGE("https://x.com/"));
		const snap = fake("browser_snapshot", () => PAGE("https://x.com/"));
		const click = fake("browser_click", () => "### Ran Playwright code");
		const wrapped = guard.tools([nav.tool, tabs.tool, snap.tool, click.tool]);
		const by = (n: string) => wrapped.find((t) => t.name === `browser__${n}`);
		await call(by("browser_tabs"), { action: "new", url: "https://x.com/" });
		expect(by("browser_click")?.confirm?.({ element: "x", target: "e6" })).toContain("Slå op");
		await call(by("browser_navigate"), { url: "https://x.com/home" });
		// The page changed and nothing re-read it, so the old e6 may be a different element now.
		expect(by("browser_click")?.confirm?.({ element: "Post button", target: "e6" })).toContain(
			"Post button",
		);
	});

	test("after typing, clicking another text field does not ask", async () => {
		const { by } = await onPage();
		await call(by("browser_type"), { target: "e3", text: "hello" });
		expect(by("browser_click")?.confirm?.({ element: "search", target: "e4" })).toBeUndefined();
		expect(by("browser_click")?.confirm?.({ element: "text box", target: "e3" })).toBeUndefined();
	});

	test("navigating away clears the after-typing rule", async () => {
		const { by } = await onPage();
		await call(by("browser_type"), { target: "e3", text: "hello" });
		await call(by("browser_navigate"), { url: "https://x.com/home" });
		await call(by("browser_snapshot"), {});
		expect(by("browser_click")?.confirm?.({ element: "x", target: "e5" })).toBeUndefined();
	});

	test("typing with submit, and Enter after typing, ask", async () => {
		const { by } = await onPage();
		expect(by("browser_type")?.confirm?.({ target: "e3", text: "hi", submit: true })).toBeDefined();
		expect(by("browser_press_key")?.confirm?.({ key: "Enter" })).toBeUndefined();
		await call(by("browser_type"), { target: "e3", text: "hi" });
		expect(by("browser_press_key")?.confirm?.({ key: "Enter" })).toBeDefined();
		expect(by("browser_press_key")?.confirm?.({ key: "Tab" })).toBeUndefined();
	});

	test("accepting a dialog asks, dismissing does not", async () => {
		const { by } = await onPage();
		expect(by("browser_handle_dialog")?.confirm?.({ accept: true })).toBeDefined();
		expect(by("browser_handle_dialog")?.confirm?.({ accept: false })).toBeUndefined();
	});

	test("reading tools never ask", async () => {
		const { by } = await onPage();
		expect(by("browser_snapshot")?.confirm?.({})).toBeUndefined();
	});
});

describe("setup errors", () => {
	test("a refused connection becomes steps the user can follow", async () => {
		const guard = createOwnChromeGuard();
		const failing = fake("browser_tabs", () => {
			return new Error(
				"Error: Could not connect to chrome: DevToolsActivePort file not found.\nNavigate to chrome://inspect/#remote-debugging",
			);
		});
		const [tool] = guard.tools([failing.tool]);
		const res = await call(tool, { action: "list" });
		expect(res.isError).toBe(true);
		expect(res.content[0]?.text).toBe(CHROME_NOT_READY);
		expect(CHROME_NOT_READY).toContain("chrome://inspect/#remote-debugging");
	});

	test("other errors pass through untouched", async () => {
		const guard = createOwnChromeGuard();
		const failing = fake("browser_click", () => new Error("Element not found"));
		const [tool] = guard.tools([failing.tool]);
		const res = await call(tool, { target: "e1" });
		expect(res.content[0]?.text).toBe("Element not found");
	});
});

describe("server command", () => {
	test("pins Playwright MCP, attaches to Chrome, and keeps output out of the project", () => {
		const opts = ownChromeServerOptions(
			undefined,
			"/proj",
			{ command: "/usr/local/bin/npx", dir: "/usr/local/bin" },
			"/usr/bin:/bin",
		);
		expect(opts.command).toBe("/usr/local/bin/npx");
		expect(opts.args).toContain(`@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`);
		expect(opts.args).toContain("--cdp-endpoint=chrome");
		expect(opts.args?.some((a) => a.startsWith("--output-dir=") && !a.includes("/proj"))).toBe(
			true,
		);
		expect(opts.namePrefix).toBe("browser");
	});

	test("puts node's folder on PATH so npx can start node under a bare PATH", () => {
		const opts = ownChromeServerOptions(
			undefined,
			"/p",
			{ command: "/usr/local/bin/npx", dir: "/usr/local/bin" },
			"/usr/bin:/bin",
		);
		expect(opts.env?.PATH).toBe("/usr/local/bin:/usr/bin:/bin");
	});

	test("uses a custom endpoint when one is configured", () => {
		const opts = ownChromeServerOptions({ chromeEndpoint: "http://127.0.0.1:9333" }, "/p", {
			command: "npx",
		});
		expect(opts.args).toContain("--cdp-endpoint=http://127.0.0.1:9333");
	});

	test("finds npx on PATH first, then in the usual install folders", () => {
		const home = "/Users/someone";
		expect(resolveNpx({ PATH: "/opt/tools" }, (p) => p === "/opt/tools/npx", home)).toEqual({
			command: "/opt/tools/npx",
			dir: "/opt/tools",
		});
		expect(resolveNpx({ PATH: "/usr/bin:/bin" }, (p) => p === "/usr/local/bin/npx", home)).toEqual({
			command: "/usr/local/bin/npx",
			dir: "/usr/local/bin",
		});
		expect(resolveNpx({}, () => false, home)).toEqual({ command: "npx" });
		expect(nodeSearchDirs(home)).toContain("/opt/homebrew/bin");
	});
});

describe("hostsInText", () => {
	test("reads hosts the user wrote", () => {
		expect(hostsInText("write about useavalon.dev on https://x.com/home please")).toEqual([
			"useavalon.dev",
			"x.com",
		]);
		expect(hostsInText("go to www.github.com/pulls.")).toEqual(["github.com"]);
		expect(hostsInText("write an article")).toEqual([]);
	});
});

describe("which browser to attach to", () => {
	const home = "/Users/someone";
	const file = (map: Record<string, string>) => (path: string) => {
		const hit = map[path];
		if (hit === undefined) throw new Error("ENOENT");
		return hit;
	};
	const ARC_FILE = `${home}/Library/Application Support/Arc/User Data/DevToolsActivePort`;

	test("Chrome is the default and is found by Playwright's channel name", () => {
		expect(resolveTarget(undefined, home)).toMatchObject({
			endpoint: "chrome",
			label: "Chrome",
			app: "chrome",
		});
		expect(resolveTarget({ app: "edge" }, home)).toMatchObject({
			endpoint: "msedge",
			label: "Edge",
		});
	});

	test("Arc is read from its own port file, as a ws:// address", () => {
		const target = resolveTarget(
			{ app: "arc" },
			home,
			file({ [ARC_FILE]: "55123\n/devtools/browser/abc-123\n" }),
		);
		expect(target).toEqual({
			endpoint: "ws://127.0.0.1:55123/devtools/browser/abc-123",
			label: "Arc",
			app: "arc",
		});
	});

	test("an Arc that is not set up fails closed and never falls through to Chrome", () => {
		const target = resolveTarget({ app: "arc" }, home, file({}));
		expect(target.endpoint).toBe(NOT_READY_ENDPOINT);
		expect(target.endpoint).not.toBe("chrome");
		expect(target.label).toBe("Arc");
	});

	test("a custom data folder is read the same way", () => {
		const target = resolveTarget(
			{ app: "brave", userDataDir: "/data/brave" },
			home,
			file({ "/data/brave/DevToolsActivePort": "40001\n/devtools/browser/zz\n" }),
		);
		expect(target.endpoint).toBe("ws://127.0.0.1:40001/devtools/browser/zz");
		expect(resolveTarget({ app: "brave", userDataDir: "/none" }, home, file({})).endpoint).toBe(
			NOT_READY_ENDPOINT,
		);
	});

	test("an explicit endpoint wins over the app", () => {
		const target = resolveTarget(
			{ app: "arc", chromeEndpoint: "http://127.0.0.1:9333" },
			home,
			file({}),
		);
		expect(target.endpoint).toBe("http://127.0.0.1:9333");
	});

	test("every app has a label and a data folder", () => {
		for (const profile of Object.values(BROWSER_APPS)) {
			expect(profile.label.length).toBeGreaterThan(0);
			expect(profile.dataDir.length).toBeGreaterThan(0);
		}
	});
});

describe("reading DevToolsActivePort", () => {
	const read = (text: string) => () => text;
	test("accepts the real two-line format", () => {
		expect(readDevToolsEndpoint("/d", read("62800\n/devtools/browser/8f6b-44a9\n"))).toBe(
			"ws://127.0.0.1:62800/devtools/browser/8f6b-44a9",
		);
	});
	test("rejects anything else", () => {
		for (const text of [
			"",
			"62800",
			"abc\n/devtools/browser/x",
			"62800\n/other/path",
			"0\n/devtools/browser/x",
			"999999\n/devtools/browser/x",
		]) {
			expect(readDevToolsEndpoint("/d", read(text))).toBeUndefined();
		}
		expect(
			readDevToolsEndpoint("/d", () => {
				throw new Error("nope");
			}),
		).toBeUndefined();
	});
});

describe("a stale port file", () => {
	const ws = {
		endpoint: "ws://127.0.0.1:55123/devtools/browser/abc",
		label: "Arc",
		app: "arc" as const,
	};
	test("is used only when something answers on the port", async () => {
		expect((await liveTarget(ws, async () => true)).endpoint).toBe(ws.endpoint);
		const dead = await liveTarget(ws, async () => false);
		expect(dead.endpoint).toBe(NOT_READY_ENDPOINT);
		expect(dead.label).toBe("Arc");
	});
	test("a channel name is not probed", async () => {
		let probed = 0;
		const chrome = { endpoint: "chrome", label: "Chrome", app: "chrome" as const };
		await liveTarget(chrome, async () => {
			probed += 1;
			return false;
		});
		expect(probed).toBe(0);
	});
	test("a closed port does not answer", async () => {
		expect(await portAnswers("ws://127.0.0.1:1/devtools/browser/x", 500)).toBe(false);
		expect(await portAnswers("not a url", 500)).toBe(false);
	});
});

describe("setup message names the browser", () => {
	test("Chrome keeps the plain steps", () => {
		expect(notReadyMessage("Chrome")).toBe(CHROME_NOT_READY);
		expect(CHROME_NOT_READY).not.toContain("no such setting");
	});
	test("Arc is named, and the agent may say the setting is missing", () => {
		const text = notReadyMessage("Arc");
		expect(text).toContain("Make sure Arc is open");
		expect(text).toContain("in Arc open chrome://inspect/#remote-debugging");
		expect(text).toContain("If Arc has no such setting, say so plainly and suggest Chrome");
	});
});

describe("the server is rebuilt after a failed attach", () => {
	function loader() {
		const started: string[] = [];
		const closed: number[] = [];
		const load: typeof import("../core/stdio-mcp.ts").loadStdioMcpTools = async (options) => {
			const id = started.length;
			started.push(options.args?.find((a) => a.startsWith("--cdp-endpoint=")) ?? "");
			return {
				tools: [
					{
						name: "browser__browser_tabs",
						description: "tabs",
						inputSchema: { type: "object", properties: {} },
						annotations: UNKNOWN_TOOL_ANNOTATIONS,
						async handler() {
							return textResult(
								"Error: Could not connect to chrome: DevToolsActivePort file not found",
								true,
							);
						},
					},
				],
				close: () => {
					closed.push(id);
				},
			};
		};
		return { load, started, closed };
	}

	test("a failed attach marks the session stale, and a good one does not", async () => {
		const { load } = loader();
		const session = await startOwnChromeTools(
			{ app: "arc" },
			"/tmp",
			load,
			async () => false,
			"/nonexistent-home",
		);
		expect(session.stale?.()).toBe(false);
		const tabs = session.tools[0];
		const res = await tabs?.handler({ action: "list" });
		expect(res?.isError).toBe(true);
		expect(res?.content[0]?.text).toContain("Make sure Arc is open");
		expect(session.stale?.()).toBe(true);
	});

	test("the attach address is read when the server starts, so a later start sees a newer port", async () => {
		const { load, started } = loader();
		await startOwnChromeTools({ app: "arc" }, "/tmp", load, async () => false, "/nonexistent-home");
		expect(started[0]).toBe(`--cdp-endpoint=${NOT_READY_ENDPOINT}`);
	});
});
