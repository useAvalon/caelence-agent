import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BROWSERS = ["Arc", "Google Chrome", "Brave Browser", "Microsoft Edge", "Chromium", "Dia"];

function escapeAppleScript(text: string): string {
	return text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function osascript(source: string, timeoutMs = 2_500): Promise<string> {
	const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", source], {
		timeout: timeoutMs,
		maxBuffer: 2_000_000,
	});
	return stdout.trim();
}

async function processIsRunning(name: string): Promise<boolean> {
	try {
		await execFileAsync("/usr/bin/pgrep", ["-x", name], { timeout: 1_000 });
		return true;
	} catch {
		try {
			await execFileAsync("/usr/bin/pgrep", ["-f", `${name}.app`], { timeout: 1_000 });
			return true;
		} catch {
			return false;
		}
	}
}

export async function runningBrowsers(): Promise<string[]> {
	const flags = await Promise.all(BROWSERS.map((name) => processIsRunning(name)));
	const fromPgrep = BROWSERS.filter((_, i) => flags[i]);
	if (fromPgrep.length > 0) return fromPgrep;
	try {
		const names = await osascript(
			'tell application "System Events" to get name of every process whose background only is false',
			2_000,
		);
		const running = new Set(names.split(",").map((item) => item.trim()));
		return BROWSERS.filter((name) => running.has(name));
	} catch {
		return [];
	}
}

export function hostOfUrl(url: string): string {
	try {
		return new URL(url.includes("://") ? url : `https://${url}`).hostname
			.replace(/^www\./, "")
			.toLowerCase();
	} catch {
		return url.replace(/^www\./, "").toLowerCase();
	}
}

export function urlListHasHost(listed: string, host: string): boolean {
	const needle = hostOfUrl(host);
	if (!needle) return false;
	return listed.split(/[\r\n,]+/).some((line) => {
		const raw = line.trim();
		if (!raw) return false;
		return hostOfUrl(raw).includes(needle) || raw.toLowerCase().includes(needle);
	});
}

export async function listTabUrls(app: string): Promise<string> {
	const name = escapeAppleScript(app);
	const simple = `tell application "${name}" to get URL of every tab of every window`;
	try {
		const out = await osascript(simple, 2_000);
		if (out.trim()) return out.replaceAll(", ", "\n");
	} catch {
		// Fall through to a walk of windows / spaces.
	}
	const source =
		app === "Arc"
			? `
set out to ""
tell application "${name}"
  repeat with w in windows
    try
      repeat with t in tabs of w
        try
          set out to out & (URL of t as text) & linefeed
        end try
      end repeat
    end try
    try
      repeat with s in spaces of w
        repeat with t in tabs of s
          try
            set out to out & (URL of t as text) & linefeed
          end try
        end repeat
      end repeat
    end try
  end repeat
end tell
return out`
			: `
set out to ""
tell application "${name}"
  repeat with w in windows
    repeat with t in tabs of w
      try
        set out to out & (URL of t as text) & linefeed
      end try
    end repeat
  end repeat
end tell
return out`;
	try {
		return await osascript(source, 2_000);
	} catch {
		return "";
	}
}

export async function focusBrowserTabByUrl(app: string, needle: string): Promise<void> {
	const host = hostOfUrl(needle) || needle;
	const front = await frontTabUrl(app).catch(() => "");
	if (front && urlListHasHost(front, host)) return;
	const name = escapeAppleScript(app);
	const hostLiteral = escapeAppleScript(host);
	const chromeStyle = `
tell application "${name}"
  repeat with w in windows
    set i to 0
    repeat with t in tabs of w
      set i to i + 1
      try
        if URL of t contains "${hostLiteral}" then
          set active tab index of w to i
          set index of w to 1
        end if
      end try
    end repeat
  end repeat
  activate
end tell`;
	const arcStyle = `
tell application "${name}"
  activate
  repeat with w in windows
    try
      tell (first tab of w whose URL contains "${hostLiteral}")
        select
      end tell
      set index of w to 1
    end try
    try
      repeat with s in spaces of w
        try
          tell (first tab of s whose URL contains "${hostLiteral}")
            select
          end tell
          set index of w to 1
        end try
      end repeat
    end try
  end repeat
end tell`;
	try {
		if (app === "Arc") await osascript(arcStyle);
		else await osascript(chromeStyle);
	} catch {
		if (app === "Arc") await osascript(chromeStyle).catch(() => undefined);
	}
}

export async function setActiveTabUrl(app: string, url: string): Promise<void> {
	const name = escapeAppleScript(app);
	const target = escapeAppleScript(url);
	await osascript(`
tell application "${name}"
  activate
  try
    set URL of active tab of front window to "${target}"
  on error
    try
      tell front window to tell active tab to set URL to "${target}"
    end try
  end try
end tell`);
}

export async function frontTabUrl(app: string): Promise<string> {
	const name = escapeAppleScript(app);
	try {
		return await osascript(
			`
tell application "${name}"
  try
    return URL of active tab of front window as text
  on error
    try
      tell front window
        tell active tab
          return URL as text
        end tell
      end tell
    end try
  end try
end tell`,
			1_500,
		);
	} catch {
		return "";
	}
}

export async function frontTabTitle(app: string): Promise<string> {
	const name = escapeAppleScript(app);
	try {
		return await osascript(
			`
tell application "${name}"
  try
    return title of active tab of front window as text
  on error
    try
      tell front window
        tell active tab
          return title as text
        end tell
      end tell
    end try
  end try
end tell`,
			1_500,
		);
	} catch {
		return "";
	}
}

/** Open a new tab only when no existing tab already has that host. */
export async function reuseOrOpenTab(
	app: string,
	url: string,
	openAs?: string,
): Promise<"reused" | "opened"> {
	const host = hostOfUrl(url);
	if (!host) {
		await openLocationInApp(app, url);
		return "opened";
	}
	const front = await frontTabUrl(app);
	if (front && urlListHasHost(front, host)) return "reused";
	await focusBrowserTabByUrl(app, host).catch(() => undefined);
	const afterFocus = await frontTabUrl(app);
	if (afterFocus && urlListHasHost(afterFocus, host)) return "reused";
	await openTabInFrontWindow(app, openAs ?? url);
	return "opened";
}

export async function activateApp(app: string): Promise<void> {
	const running = await runningBrowsers();
	if (!running.includes(app)) {
		await execFileAsync("/usr/bin/open", ["-a", app], { timeout: 5_000 }).catch(() => undefined);
	}
	await focusApp(app);
}

/** Raise the app without `open -a`, which focuses Chrome's address bar. */
export async function focusApp(app: string): Promise<void> {
	const name = escapeAppleScript(app);
	await osascript(
		`
tell application "System Events"
  repeat 8 times
    try
      set frontmost of process "${name}" to true
    end try
    delay 0.08
    set n to name of first process whose frontmost is true
    if n is "${name}" then exit repeat
  end repeat
end tell`,
		2_000,
	).catch(() => undefined);
}

export async function frontmostBrowser(): Promise<string | undefined> {
	const front = await frontmostProcess();
	const running = await runningBrowsers();
	const lowered = front.toLowerCase();
	return (
		running.find((name) => name === front) ??
		running.find((name) => name.toLowerCase().includes("chrome") && lowered.includes("chrome")) ??
		running.find((name) => lowered.includes(name.toLowerCase()))
	);
}

export async function frontmostProcess(): Promise<string> {
	try {
		return await osascript(
			'tell application "System Events" to get name of first process whose frontmost is true',
			1_200,
		);
	} catch {
		return "";
	}
}

export async function runningAppNames(): Promise<string[]> {
	try {
		const raw = await osascript(
			'tell application "System Events" to get name of every process whose background only is false',
			2_000,
		);
		return raw
			.split(",")
			.map((name) => name.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

export async function isAppFrontmost(app: string): Promise<boolean> {
	const front = await frontmostProcess();
	if (front === app) return true;
	const a = app.toLowerCase();
	const f = front.toLowerCase();
	if (a.includes("chrome") && f.includes("chrome")) return true;
	return false;
}

export async function focusedValue(app: string): Promise<string> {
	const name = escapeAppleScript(app);
	try {
		return await osascript(
			`tell application "System Events" to tell process "${name}" to get value of focused UI element as text`,
			2_000,
		);
	} catch {
		return "";
	}
}

/** Brings that app forward and opens the URL in it (new tab if needed). */
export async function openUrlInApp(app: string, url: string): Promise<void> {
	await execFileAsync("/usr/bin/open", ["-a", app, url], { timeout: 8_000 });
	await focusApp(app);
}

/** Open this exact page in the browser already running. Does not reuse a different tab on the same site. */
export async function showPageInBrowser(url: string): Promise<void> {
	const front = await frontmostBrowser();
	const app = front ?? (await runningBrowsers())[0];
	if (!app) {
		await execFileAsync("/usr/bin/open", [url], { timeout: 8_000 });
		return;
	}
	await openTabInFrontWindow(app, url);
	await focusApp(app);
}

/** New tab in the current window. Avoids Arc Little Arc from `open location`. */
export async function openTabInFrontWindow(app: string, url: string): Promise<void> {
	const name = escapeAppleScript(app);
	const target = escapeAppleScript(url);
	if (app === "Arc") {
		await osascript(`
tell application "${name}"
  activate
  tell front window
    make new tab with properties {URL:"${target}"}
  end tell
end tell`);
		return;
	}
	await osascript(`
tell application "${name}"
  activate
  tell front window
    make new tab with properties {URL:"${target}"}
  end tell
end tell`).catch(() => openUrlInApp(app, url));
}

export async function evalBrowserJs<T>(app: string, expression: string): Promise<T> {
	const wrapped = `JSON.stringify((function(){ try { return (${expression}); } catch (e) { return {__error: String(e)}; } })())`;
	const dir = await mkdtemp(join(tmpdir(), "caelence-js-"));
	const file = join(dir, "eval.js");
	try {
		await writeFile(file, wrapped, "utf8");
		const posix = escapeAppleScript(file);
		const name = escapeAppleScript(app);
		const source =
			app === "Arc"
				? `
set js to do shell script "cat " & quoted form of "${posix}"
tell application "Arc"
  try
    tell front window
      tell active tab
        return execute javascript js
      end tell
    end tell
  on error
    return execute javascript js in active tab of front window
  end try
end tell`
				: `
set js to do shell script "cat " & quoted form of "${posix}"
tell application "${name}"
  try
    return execute javascript js in active tab of front window
  on error
    return do JavaScript js in active tab of front window
  end try
end tell`;
		const raw = await osascript(source, 2_500);
		if (!raw) return undefined as T;
		try {
			let parsed: unknown = JSON.parse(raw);
			if (typeof parsed === "string") parsed = JSON.parse(parsed);
			const value = parsed as T & { __error?: string };
			if (value && typeof value === "object" && "__error" in value && value.__error) {
				throw new Error(value.__error);
			}
			return value;
		} catch (err) {
			if (err instanceof SyntaxError) return raw as T;
			throw err;
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export async function probeBrowserJs(app: string): Promise<boolean> {
	try {
		const value = await evalBrowserJs<number>(app, "1");
		return value === 1;
	} catch {
		return false;
	}
}

export async function openLocationInApp(app: string, url: string): Promise<void> {
	const name = escapeAppleScript(app);
	const target = escapeAppleScript(url);
	await osascript(`tell application "${name}" to open location "${target}"`);
}

export async function attachAppleScriptBrowser(preferUrl?: string): Promise<string | undefined> {
	const running = await runningBrowsers();
	if (running.length === 0) return undefined;
	const needle = preferUrl ? hostOfUrl(preferUrl) : undefined;
	for (const app of running) {
		if (needle) await focusBrowserTabByUrl(app, needle).catch(() => undefined);
		if (await probeBrowserJs(app)) return app;
	}
	return undefined;
}
