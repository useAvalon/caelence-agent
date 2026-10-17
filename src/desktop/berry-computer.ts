import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_MODELS, modelFor, titleForRole } from "../cli/defaults.ts";
import { reuseOrOpenTab } from "../computer/browser/applescript-driver.ts";
import { type GlanceWindow, pickGlanceWindow } from "../computer/glance.ts";
import { OPENROUTER_DEFAULT_BASE_URL } from "../config.ts";
import {
	errorResult,
	type McpToolAnnotations,
	type McpToolDefinition,
	textResult,
} from "../core/mcp.ts";

const execFileAsync = promisify(execFile);

const SCREEN_ANNOTATIONS: McpToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
};

const LOOK_ANNOTATIONS: McpToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
};

/** Vision model used only to label click targets on a screenshot. */
export const BERRY_SCREEN_MODEL = DEFAULT_MODELS.vision;

const KEY_CODES: Record<string, number> = {
	return: 36,
	enter: 36,
	tab: 48,
	space: 49,
	delete: 51,
	backspace: 51,
	escape: 53,
	esc: 53,
	left: 123,
	right: 124,
	down: 125,
	up: 126,
};

export function escapeAppleScriptString(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function clampPoint(x: number, y: number): { x: number; y: number } | undefined {
	if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
	if (x < -8_000 || y < -8_000 || x > 20_000 || y > 20_000) return undefined;
	return { x: Math.round(x), y: Math.round(y) };
}

export interface ScreenTarget {
	id: string;
	text: string;
	x: number;
	y: number;
}

let lastScreenTargets: ScreenTarget[] = [];

/** Last browser window we photographed, so clicks in the address bar can be rejected. */
let lastBrowserFrame: { x: number; y: number; width: number; height: number } | undefined;

export function setLastScreenTargets(targets: readonly ScreenTarget[]): void {
	lastScreenTargets = [...targets];
}

export function formatScreenTargets(targets: readonly ScreenTarget[]): string {
	if (targets.length === 0) return "(no text found)";
	return targets.map((item) => `${item.id} @${item.x},${item.y} "${item.text}"`).join("\n");
}

/** Click by L12 / W3 from the last look, or by a short label such as "search". */
export function resolveScreenTarget(idOrLabel: string): ScreenTarget | undefined {
	const needle = idOrLabel.trim();
	if (!needle) return undefined;
	const byId = lastScreenTargets.find((item) => item.id.toLowerCase() === needle.toLowerCase());
	if (byId) return byId;
	const lowered = needle.toLowerCase();
	const matches = lastScreenTargets.filter((item) => item.text.toLowerCase().includes(lowered));
	if (matches.length === 0) return undefined;
	const shortest = [...matches].toSorted((a, b) => a.text.length - b.text.length)[0];
	if (!shortest) return undefined;
	return shortest;
}

function clickPointFromRaw(raw: { id?: unknown; x?: unknown; y?: unknown }): {
	x: number;
	y: number;
} {
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (id) {
		const target = resolveScreenTarget(id);
		if (!target) {
			throw new Error(
				`Unknown target "${id}". Use an id from the last look_at_screen (L12, or search).`,
			);
		}
		return { x: target.x, y: target.y };
	}
	return { x: asNumber(raw.x), y: asNumber(raw.y) };
}

/** Vision OCR rows: id, nx, ny, nw, nh, text — box origin is bottom-left, 0–1. */
export function visionRowsToTargets(
	raw: string,
	originX: number,
	originY: number,
	width: number,
	height: number,
): ScreenTarget[] {
	const targets: ScreenTarget[] = [];
	if (!(width > 0) || !(height > 0)) return targets;
	for (const line of raw.split("\n")) {
		const [id, nx, ny, nw, nh, ...rest] = line.split("\t");
		if (!id) continue;
		const xNorm = Number(nx);
		const yNorm = Number(ny);
		const wNorm = Number(nw);
		const hNorm = Number(nh);
		if (![xNorm, yNorm, wNorm, hNorm].every(Number.isFinite)) continue;
		const text = rest.join("\t").trim();
		if (!text) continue;
		targets.push({
			id,
			text: text.slice(0, 80),
			x: Math.round(originX + (xNorm + wNorm / 2) * width),
			y: Math.round(originY + (1 - yNorm - hNorm / 2) * height),
		});
	}
	return targets;
}

/** Gemini lines become T1, T2 so the model can click by id. */
export function labeledLinesToTargets(text: string): ScreenTarget[] {
	const targets: ScreenTarget[] = [];
	let index = 0;
	for (const line of text.split("\n")) {
		const match = line.match(/^\s*(\d+)\s*,\s*(\d+)\s+(.*)$/);
		if (!match) continue;
		index += 1;
		const label = match[3]?.trim() ?? "";
		targets.push({
			id: `T${index}`,
			text: label.slice(0, 80),
			x: Number(match[1]),
			y: Number(match[2]),
		});
	}
	return targets;
}

/** Vision labels are image pixels. Quartz clicks are points, and Retina screens are 2x. */
export function rewriteClickTargets(text: string, scale: number, originX = 0, originY = 0): string {
	const factor = scale > 0 ? scale : 1;
	return text
		.split("\n")
		.map((line) => {
			const match = line.match(/^\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s+(.*)$/);
			if (!match) return line;
			const x = Math.round(originX + Number(match[1]) / factor);
			const y = Math.round(originY + Number(match[2]) / factor);
			return `${x},${y} ${match[3]}`;
		})
		.join("\n");
}

function asNumber(value: unknown): number {
	return typeof value === "number" ? value : Number.NaN;
}

async function runOsascript(args: string[], timeoutMs = 8_000): Promise<string> {
	try {
		const { stdout } = await execFileAsync("/usr/bin/osascript", args, {
			timeout: timeoutMs,
			maxBuffer: 1_000_000,
		});
		return stdout.trim();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/not allowed|1002|assistive|accessibility/i.test(message)) {
			throw new Error(
				"Mac blocked the click. Allow this app (Terminal or Caelence) under System Settings → Privacy & Security → Accessibility, then try again.",
			);
		}
		throw new Error(message.split("\n")[0] ?? "osascript failed");
	}
}

/** Window focused this turn, so a later look does not jump to another browser. */
let focusedWindow: ScreenWindow | undefined;

export function isInsideBrowserFrame(
	x: number,
	y: number,
	frame: { x: number; y: number; width: number; height: number },
): boolean {
	return (
		x >= frame.x - 8 &&
		x <= frame.x + frame.width + 8 &&
		y >= frame.y - 8 &&
		y <= frame.y + frame.height + 8
	);
}

/** The toolbar and address bar sit in the top of a browser window. Clicks there change the URL. */
export function isBrowserChromePoint(
	x: number,
	y: number,
	frame: { x: number; y: number; width: number; height: number },
): boolean {
	const localY = y - frame.y;
	const localX = x - frame.x;
	return localY >= -8 && localY < 96 && localX >= -8 && localX <= frame.width + 8;
}

/** Glide the pointer to the point, then click, so the move is visible. */
export async function clickAt(x: number, y: number): Promise<void> {
	const point = clampPoint(x, y);
	if (!point) throw new Error("x and y must be screen coordinates from look_at_screen");
	if (lastBrowserFrame && !isInsideBrowserFrame(point.x, point.y, lastBrowserFrame)) {
		throw new Error(
			"That point is outside the browser window. Use a target from the last look_at_screen.",
		);
	}
	if (lastBrowserFrame && isBrowserChromePoint(point.x, point.y, lastBrowserFrame)) {
		throw new Error(
			"That point is in the browser address bar. Pick a control further down the page from look_at_screen.",
		);
	}
	const script = `
ObjC.import("CoreGraphics");
ObjC.import("Foundation");
function run(argv) {
  const x = Number(argv[0]);
  const y = Number(argv[1]);
  const target = $.CGPointMake(x, y);
  const current = $.CGEventGetLocation($.CGEventCreate(null));
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = $.CGPointMake(current.x + (x - current.x) * t, current.y + (y - current.y) * t);
    $.CGWarpMouseCursorPosition(p);
    const move = $.CGEventCreateMouseEvent(null, 5, p, 0);
    $.CGEventPost(0, move);
    $.NSThread.sleepForTimeInterval(0.008);
  }
  $.NSThread.sleepForTimeInterval(0.04);
  const down = $.CGEventCreateMouseEvent(null, 1, target, 0);
  const up = $.CGEventCreateMouseEvent(null, 2, target, 0);
  $.CGEventPost(0, down);
  $.NSThread.sleepForTimeInterval(0.05);
  $.CGEventPost(0, up);
  return "ok";
}`;
	await runOsascript(["-l", "JavaScript", "-e", script, String(point.x), String(point.y)]);
}

export async function clickAndType(x: number, y: number, text: string): Promise<void> {
	await clickAt(x, y);
	await new Promise((resolve) => setTimeout(resolve, 150));
	await pressKey("a", ["command"]);
	await typeText(text);
}

export async function typeText(text: string): Promise<void> {
	const trimmed = text.replaceAll("\0", "");
	if (!trimmed) throw new Error("text is empty");
	if (trimmed.length > 4_000) throw new Error("text is too long");
	const script = `tell application "System Events" to keystroke "${escapeAppleScriptString(trimmed)}"`;
	await runOsascript(["-e", script], 20_000);
}

export async function pressKey(name: string, modifiers: string[] = []): Promise<void> {
	const key = name.trim().toLowerCase();
	const code = KEY_CODES[key];
	if (code === undefined) {
		throw new Error(`Unknown key "${name}". Use return, tab, escape, space, delete, or an arrow.`);
	}
	const allowed = new Set(["command", "shift", "option", "control"]);
	const using = modifiers
		.map((item) => item.trim().toLowerCase())
		.filter((item) => allowed.has(item));
	const usingClause =
		using.length > 0 ? ` using {${using.map((item) => `${item} down`).join(", ")}}` : "";
	const script = `tell application "System Events" to key code ${code}${usingClause}`;
	await runOsascript(["-e", script]);
}

export async function scrollScreen(dy: number): Promise<void> {
	if (!Number.isFinite(dy) || dy === 0)
		throw new Error("dy must be a non-zero number of scroll ticks");
	const ticks = Math.max(-40, Math.min(40, Math.round(dy)));
	const script = `
ObjC.import("CoreGraphics");
function run(argv) {
  const dy = Number(argv[0]);
  const event = $.CGEventCreateScrollWheelEvent(null, 0, 1, dy);
  $.CGEventPost(0, event);
  return "ok";
}`;
	await runOsascript(["-l", "JavaScript", "-e", script, String(ticks)]);
}

export interface ScreenWindow {
	id: number;
	owner: string;
	x: number;
	y: number;
	width: number;
	height: number;
	title: string;
}

export function isBrowserOwner(owner: string): boolean {
	return /arc|chrome|safari|brave|edge|firefox|orion|dia|chromium/i.test(owner);
}

export function parseWindowList(text: string): ScreenWindow[] {
	const windows: ScreenWindow[] = [];
	for (const line of text.split("\n")) {
		const [id, owner, x, y, width, height, ...title] = line.split("\t");
		const parsed = {
			id: Number(id),
			owner: owner ?? "",
			x: Number(x),
			y: Number(y),
			width: Number(width),
			height: Number(height),
			title: title.join("\t"),
		};
		if (!Number.isFinite(parsed.id) || !parsed.owner) continue;
		windows.push(parsed);
	}
	return windows;
}

/** Prefer a browser window. A named browser in the query wins over whichever browser is listed first. */
export function pickBrowserWindow(
	windows: ScreenWindow[],
	query?: string,
): ScreenWindow | undefined {
	const browsers = windows.filter((window) => isBrowserOwner(window.owner));
	const needle = query?.trim().toLowerCase() ?? "";
	if (!needle) return browsers[0];
	const namedOwners = [
		...new Set(
			browsers
				.map((window) => window.owner)
				.filter((owner) =>
					owner
						.toLowerCase()
						.split(/\s+/)
						.some((part) => part.length > 2 && needle.includes(part)),
				),
		),
	];
	const scoped =
		namedOwners.length > 0
			? browsers.filter((window) => namedOwners.includes(window.owner))
			: browsers;
	const words = needle.split(/\s+/).filter((word) => word.length > 2);
	return (
		scoped.find((window) => {
			const label = `${window.owner} ${window.title}`.toLowerCase();
			return words.every((word) => label.includes(word));
		}) ?? scoped[0]
	);
}

function windowListScript(processNames: string[]): string {
	const literal = processNames.map((name) => `"${escapeAppleScriptString(name)}"`).join(", ");
	return `
set appNames to {${literal}}
set out to ""
tell application "System Events"
  repeat with appName in appNames
    set procName to appName as text
    tell process procName
      repeat with w in windows
        try
          set p to position of w
          set s to size of w
          set t to name of w
          set out to out & "0" & tab & procName & tab & (item 1 of p as text) & tab & (item 2 of p as text) & tab & (item 1 of s as text) & tab & (item 2 of s as text) & tab & t & linefeed
        end try
      end repeat
    end tell
  end repeat
end tell
return out`;
}

async function runningBrowserProcesses(): Promise<string[]> {
	const text = await runOsascript(
		[
			"-e",
			'tell application "System Events" to get name of every process whose background only is false',
		],
		4_000,
	);
	return text
		.split(",")
		.map((name) => name.trim())
		.filter((name) => isBrowserOwner(name));
}

async function listOnScreenWindows(): Promise<ScreenWindow[]> {
	const browsers = await runningBrowserProcesses();
	if (browsers.length === 0) return [];
	const text = await runOsascript(["-e", windowListScript(browsers)], 8_000);
	return parseWindowList(text);
}

function formatBrowserWindows(windows: ScreenWindow[]): string {
	const browsers = windows.filter((window) => isBrowserOwner(window.owner));
	if (browsers.length === 0) {
		return "No Arc, Chrome, Safari, or other browser windows are open.";
	}
	return browsers.map((window) => `${window.owner} | ${window.title || "(untitled)"}`).join("\n");
}

let focusGlow: ReturnType<typeof spawn> | undefined;

const FOCUS_GLOW_SCRIPT = `
ObjC.import("Cocoa");
function run(argv) {
  const x = Number(argv[0]);
  const y = Number(argv[1]);
  const w = Number(argv[2]);
  const h = Number(argv[3]);
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy(1);
  const screens = $.NSScreen.screens;
  let primaryHeight = 0;
  for (let i = 0; i < screens.count; i++) {
    const frame = screens.objectAtIndex(i).frame;
    if (Number(frame.origin.x) === 0 && Number(frame.origin.y) === 0) {
      primaryHeight = Number(frame.size.height);
    }
  }
  if (!(primaryHeight > 0)) primaryHeight = Number($.NSScreen.mainScreen.frame.size.height);
  const cocoaY = primaryHeight - y - h;
  const win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
    $.NSMakeRect(x, cocoaY, w, h),
    0,
    2,
    false
  );
  win.setOpaque(false);
  win.setBackgroundColor($.NSColor.clearColor);
  win.setIgnoresMouseEvents(true);
  win.setHasShadow(false);
  win.setLevel(25);
  win.setCollectionBehavior(1 | 256);
  const view = win.contentView;
  view.setWantsLayer(true);
  const layer = view.layer;
  const color = $.NSColor.colorWithRedGreenBlueAlpha(110 / 255, 147 / 255, 184 / 255, 1);
  layer.setBorderWidth(5);
  layer.setBorderColor(color.CGColor);
  layer.setCornerRadius(14);
  layer.setShadowColor(color.CGColor);
  layer.setShadowOpacity(0.85);
  layer.setShadowRadius(18);
  layer.setShadowOffset($.NSMakeSize(0, 0));
  win.orderFrontRegardless;
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    $.NSRunLoop.currentRunLoop.runModeBeforeDate(
      "kCFRunLoopDefaultMode",
      $.NSDate.dateWithTimeIntervalSinceNow(0.2)
    );
  }
}
`;

function showFocusGlow(window: ScreenWindow): void {
	if (!(window.width >= 80 && window.height >= 80)) return;
	if (focusGlow && !focusGlow.killed) focusGlow.kill();
	const child = spawn(
		"/usr/bin/osascript",
		[
			"-l",
			"JavaScript",
			"-e",
			FOCUS_GLOW_SCRIPT,
			String(Math.round(window.x)),
			String(Math.round(window.y)),
			String(Math.round(window.width)),
			String(Math.round(window.height)),
		],
		{ detached: true, stdio: "ignore" },
	);
	child.unref();
	focusGlow = child;
}

function hideFocusGlow(): void {
	if (focusGlow && !focusGlow.killed) focusGlow.kill();
	focusGlow = undefined;
}

async function raiseBrowserWindow(window: ScreenWindow): Promise<void> {
	const owner = escapeAppleScriptString(window.owner);
	const title = escapeAppleScriptString(window.title);
	const script = `
tell application "System Events"
  if exists process "${owner}" then
    tell process "${owner}"
      set frontmost to true
      repeat with w in windows
        try
          if name of w contains "${title}" then
            perform action "AXRaise" of w
          end if
        end try
      end repeat
    end tell
    delay 0.4
  end if
end tell`;
	await runOsascript(["-e", script], 8_000);
	showFocusGlow(window);
}

/** Open a URL in the browser already on screen, so Arc is not replaced by Chrome. */
export async function openUrlInRunningBrowser(url: string): Promise<string> {
	let front = "";
	try {
		front = (
			await runOsascript(
				[
					"-e",
					'tell application "System Events" to get name of first application process whose frontmost is true',
				],
				4_000,
			)
		).trim();
	} catch {
		front = "";
	}
	const windows = await listOnScreenWindows().catch(() => []);
	const openBrowser = windows.find((window) => isBrowserOwner(window.owner))?.owner;
	const target = isBrowserOwner(front) ? front : openBrowser;
	if (!target) {
		await execFileAsync("/usr/bin/open", [url]);
		return `Opened ${url} in the default browser.`;
	}
	const result = await reuseOrOpenTab(target, url);
	return result === "reused"
		? `Focused the existing ${target} tab for ${url}.`
		: `Opened ${url} in ${target}. Stay in this browser.`;
}

export async function listBrowserTabs(): Promise<string> {
	const windows = await listOnScreenWindows();
	return formatBrowserWindows(windows);
}

export async function focusBrowserTab(query: string): Promise<string> {
	const needle = query.trim();
	if (needle.length < 2) throw new Error("Say which window to focus, for example Canva");
	const windows = await listOnScreenWindows();
	const match = pickBrowserWindow(windows, needle);
	if (!match) {
		const open = formatBrowserWindows(windows);
		return `No window title matched "${needle}". Browsers that are open:\n${open}`;
	}
	focusedWindow = match;
	await raiseBrowserWindow(match);
	const title = match.title || "untitled window";
	return `Brought ${match.owner} to the front. ${match.owner} is the browser. Window: ${title}.`;
}

async function mainDisplayScale(): Promise<{ scale: number; originX: number; originY: number }> {
	const script = `
ObjC.import("AppKit");
function run() {
  const screen = $.NSScreen.mainScreen;
  const frame = screen.frame;
  const scale = Number(screen.backingScaleFactor);
  const screens = $.NSScreen.screens;
  let primaryHeight = Number(frame.size.height);
  const count = screens.count;
  for (let i = 0; i < count; i++) {
    const other = screens.objectAtIndex(i);
    const otherFrame = other.frame;
    if (Number(otherFrame.origin.x) === 0 && Number(otherFrame.origin.y) === 0) {
      primaryHeight = Number(otherFrame.size.height);
    }
  }
  const originX = Number(frame.origin.x);
  const originY = primaryHeight - Number(frame.origin.y) - Number(frame.size.height);
  return scale + "," + originX + "," + originY;
}`;
	try {
		const raw = await runOsascript(["-l", "JavaScript", "-e", script], 4_000);
		const parts = raw.split(",").map(Number);
		const scale = parts[0] ?? Number.NaN;
		const originX = parts[1] ?? Number.NaN;
		const originY = parts[2] ?? Number.NaN;
		if (!Number.isFinite(scale) || scale <= 0) return { scale: 1, originX: 0, originY: 0 };
		return {
			scale,
			originX: Number.isFinite(originX) ? originX : 0,
			originY: Number.isFinite(originY) ? originY : 0,
		};
	} catch {
		return { scale: 1, originX: 0, originY: 0 };
	}
}

async function windowScale(file: string, pointWidth: number): Promise<number> {
	if (!(pointWidth > 0)) return 1;
	try {
		const { stdout } = await execFileAsync("/usr/bin/sips", ["-g", "pixelWidth", file], {
			timeout: 4_000,
		});
		const match = stdout.match(/pixelWidth:\s*(\d+)/);
		const pixels = match ? Number(match[1]) : Number.NaN;
		if (!Number.isFinite(pixels) || pixels <= 0) return 1;
		return pixels / pointWidth;
	} catch {
		return 1;
	}
}

async function describeScreenshot(input: {
	png: Buffer;
	apiKey: string;
	fetchImpl?: typeof fetch;
}): Promise<string> {
	const base = OPENROUTER_DEFAULT_BASE_URL.replace(/\/+$/, "");
	const fetchImpl = input.fetchImpl ?? globalThis.fetch;
	const res = await fetchImpl(`${base}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${input.apiKey}`,
			"Content-Type": "application/json",
			"HTTP-Referer": "https://caelence.com",
			"X-Title": titleForRole("vision"),
		},
		body: JSON.stringify({
			model: modelFor("vision"),
			max_tokens: 700,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "This image is one browser or app window, not the whole desktop. List clickable controls on the page (buttons, fields, menus). One per line: x,y label. x and y are pixel centers from the top-left of this image. At most 30 lines. No prose.",
						},
						{
							type: "image_url",
							image_url: { url: `data:image/jpeg;base64,${input.png.toString("base64")}` },
						},
					],
				},
			],
		}),
	});
	if (!res.ok) {
		const detail = await res.text();
		throw new Error(`Screen description failed (${res.status}): ${detail.slice(0, 180)}`);
	}
	const json = (await res.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	return json.choices?.[0]?.message?.content?.trim() || "No click targets returned.";
}

const VISION_OCR_SCRIPT = `
ObjC.import("Vision");
ObjC.import("Foundation");
function run(argv) {
  const path = argv[0];
  const url = $.NSURL.fileURLWithPath(path);
  const request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = 1;
  request.usesLanguageCorrection = true;
  const handler = $.VNImageRequestHandler.alloc.initWithURL_options(url, $());
  const err = $();
  const ok = handler.performRequests_error($([request]), err);
  if (!ok) return "";
  const results = request.results;
  const n = Number(results.count);
  const lines = [];
  for (let i = 0; i < n && i < 80; i++) {
    const obs = results.objectAtIndex(i);
    const cands = obs.topCandidates(1);
    if (Number(cands.count) < 1) continue;
    const text = cands.objectAtIndex(0).string.js;
    const box = obs.boundingBox;
    lines.push(
      ["L" + (i + 1), box.origin.x, box.origin.y, box.size.width, box.size.height, text].join("\\t"),
    );
  }
  return lines.join("\\n");
}`;

const FRONT_WINDOW_SCRIPT = `
ObjC.import("Cocoa");
function run() {
  const front = Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier);
  const info = $.CGWindowListCopyWindowInfo(17, 0);
  const n = Number(info.count);
  const lines = [];
  for (let i = 0; i < n; i++) {
    const win = info.objectAtIndex(i);
    if (Number(win.objectForKey("kCGWindowLayer")) !== 0) continue;
    const bounds = win.objectForKey("kCGWindowBounds");
    const width = Number(bounds.objectForKey("Width"));
    const height = Number(bounds.objectForKey("Height"));
    if (!(width >= 80) || !(height >= 80)) continue;
    const ownerObj = win.objectForKey("kCGWindowOwnerName");
    const owner = ownerObj ? String(ownerObj.js || "") : "";
    const titleObj = win.objectForKey("kCGWindowName");
    const title = titleObj ? String(titleObj.js || "") : "";
    const idObj = win.objectForKey("kCGWindowNumber");
    const id = String(idObj && idObj.js != null ? idObj.js : idObj);
    const pid = Number(win.objectForKey("kCGWindowOwnerPID"));
    lines.push([owner, title, id, width, height, pid === front ? "1" : "0"].join("\\t"));
  }
  return lines.join("\\n");
}
`;

function parseGlanceWindows(raw: string): GlanceWindow[] {
	return raw
		.split("\n")
		.map((line) => line.split("\t"))
		.filter((parts) => parts.length >= 6 && parts[2])
		.map((parts) => ({
			owner: parts[0] ?? "",
			title: parts[1] ?? "",
			id: parts[2] ?? "",
			width: Number(parts[3]) || 0,
			height: Number(parts[4]) || 0,
			front: parts[5] === "1",
		}));
}

/** Photograph the window the user is asking about and answer from that image. */
export async function answerAboutFrontWindow(message: string): Promise<string> {
	const listed = await runOsascript(["-l", "JavaScript", "-e", FRONT_WINDOW_SCRIPT], 2_500).catch(
		() => "",
	);
	const window = pickGlanceWindow(parseGlanceWindows(listed), message);
	if (!window) return "I couldn't see an open window.";
	const dir = await mkdtemp(join(tmpdir(), "caelence-glance-"));
	const file = join(dir, "window.png");
	const preview = join(dir, "preview.jpg");
	try {
		await execFileAsync("/usr/sbin/screencapture", ["-l", window.id, "-x", file], {
			timeout: 4_000,
		});
		await execFileAsync(
			"/usr/bin/sips",
			["-Z", "1280", "-s", "format", "jpeg", file, "--out", preview],
			{
				timeout: 4_000,
			},
		);
		const jpeg = await readFile(preview);
		const key = process.env.OPENROUTER_API_KEY?.trim() || "";
		if (!key) return `${window.owner} is open, but there is no API key to read the image.`;
		return await answerFromWindowImage({
			jpeg,
			question: message,
			apiKey: key,
			owner: window.owner,
			title: window.title,
		});
	} catch {
		return `I couldn't capture the ${window.owner} window.`;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Answer from a frame the world-state buffer already holds. Does not start a capture. */
export async function answerAboutBufferedFrame(input: {
	jpeg: Buffer;
	question: string;
	caption: string;
}): Promise<string> {
	const key = process.env.OPENROUTER_API_KEY?.trim() || "";
	if (!key)
		return input.caption || "The window is in front, but there is no API key to read the image.";
	return answerFromWindowImage({
		jpeg: input.jpeg,
		question: input.question,
		apiKey: key,
		owner: "screen",
		title: input.caption.slice(0, 180),
	});
}

/** Short social post from the live frame. One small completion, not a long screen essay. */
export async function draftSocialPostFromFrame(input: {
	jpeg: Buffer;
	question: string;
	caption: string;
}): Promise<string> {
	const key = process.env.OPENROUTER_API_KEY?.trim() || "";
	if (!key) return "";
	return answerFromWindowImage({
		jpeg: input.jpeg,
		question: input.question,
		apiKey: key,
		owner: "screen",
		title: input.caption.slice(0, 120),
		maxTokens: 220,
		instruction:
			"Write ONLY the social post from this live window. No greeting, title line, or 'here is a post'. At most 8 short lines. Match the user's language.",
	});
}

async function answerFromWindowImage(input: {
	jpeg: Buffer;
	question: string;
	apiKey: string;
	owner: string;
	title: string;
	maxTokens?: number;
	instruction?: string;
}): Promise<string> {
	const base = OPENROUTER_DEFAULT_BASE_URL.replace(/\/+$/, "");
	const lead =
		input.instruction ??
		"This image is the window as it looks right now (the live stream, including where they scrolled). Answer from what is visible. Ignore any older description if it disagrees with the image.";
	const res = await fetch(`${base}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${input.apiKey}`,
			"Content-Type": "application/json",
			"HTTP-Referer": "https://caelence.com",
			"X-Title": titleForRole("vision"),
		},
		body: JSON.stringify({
			model: modelFor("vision"),
			max_tokens: input.maxTokens ?? 900,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: `${lead}\n\n${input.title}\n\n${input.question}`,
						},
						{
							type: "image_url",
							image_url: { url: `data:image/jpeg;base64,${input.jpeg.toString("base64")}` },
						},
					],
				},
			],
		}),
	});
	if (!res.ok) {
		return `I captured ${input.owner}, but couldn't read the image.`;
	}
	const json = (await res.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	return json.choices?.[0]?.message?.content?.trim() || `I captured the ${input.owner} window.`;
}

async function recognizeTextInImage(
	file: string,
	originX: number,
	originY: number,
	width: number,
	height: number,
): Promise<ScreenTarget[]> {
	try {
		const raw = await runOsascript(["-l", "JavaScript", "-e", VISION_OCR_SCRIPT, file], 12_000);
		return visionRowsToTargets(raw, originX, originY, width, height);
	} catch {
		return [];
	}
}

function finishLook(header: string, targets: ScreenTarget[]): string {
	lastScreenTargets = targets;
	return `${header}\nTargets (click or click_and_type by id, then keep going — do not look again):\n${formatScreenTargets(targets)}`;
}

export async function lookAtScreen(
	options: { apiKey?: string; fetchImpl?: typeof fetch; query?: string } = {},
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "caelence-screen-"));
	const file = join(dir, "screen.png");
	try {
		const windows = await listOnScreenWindows();
		const browser = options.query
			? pickBrowserWindow(windows, options.query)
			: (focusedWindow ?? pickBrowserWindow(windows));
		const captureArgs = ["-x", "-t", "png"];
		let originX = 0;
		let originY = 0;
		let width = 0;
		let height = 0;
		let header: string;
		if (browser && browser.width >= 80 && browser.height >= 80) {
			await raiseBrowserWindow(browser).catch(() => undefined);
			captureArgs.push(
				"-R",
				`${Math.round(browser.x)},${Math.round(browser.y)},${Math.round(browser.width)},${Math.round(browser.height)}`,
			);
			originX = browser.x;
			originY = browser.y;
			width = browser.width;
			height = browser.height;
			lastBrowserFrame = {
				x: browser.x,
				y: browser.y,
				width: browser.width,
				height: browser.height,
			};
			header = `Captured the ${browser.owner} window "${browser.title || "untitled"}". Use target ids. Do not click the address bar. Do not tell the user to finish the task.`;
		} else {
			captureArgs.push("-m");
			const geometry = await mainDisplayScale();
			originX = geometry.originX;
			originY = geometry.originY;
			header = `No browser window to capture.\n${formatBrowserWindows(windows)}`;
		}
		captureArgs.push(file);
		await execFileAsync("/usr/sbin/screencapture", captureArgs, { timeout: 8_000 });
		if (width > 0 && height > 0) {
			const ocr = await recognizeTextInImage(file, originX, originY, width, height);
			if (ocr.length > 0) {
				return finishLook(header, ocr);
			}
		}
		const preview = join(dir, "preview.jpg");
		await execFileAsync(
			"/usr/bin/sips",
			["-Z", "1280", "-s", "format", "jpeg", file, "--out", preview],
			{
				timeout: 8_000,
			},
		);
		const png = await readFile(preview);
		const scale = browser
			? await windowScale(preview, browser.width)
			: (await mainDisplayScale()).scale;
		const key = options.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";
		if (!key) {
			return `${header}\nNo click targets (local text read was empty, and there is no API key).`;
		}
		const labels = await describeScreenshot({ png, apiKey: key, fetchImpl: options.fetchImpl });
		const points = rewriteClickTargets(labels, scale, originX, originY);
		return finishLook(header, labeledLinesToTargets(points));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const NAVIGATE_TOOLS = new Set([
	"list_browser_tabs",
	"focus_browser_tab",
	"open_url",
	"open_app",
	"open_search",
]);
const SCREEN_ACTION_LIMIT = 16;
let screenActions = 0;
let browserLocked = false;

let allowedHosts: Set<string> | null = null;

export function resetBerryScreenBudget(): void {
	screenActions = 0;
	browserLocked = false;
	allowedHosts = null;
	focusedWindow = undefined;
	lastBrowserFrame = undefined;
	lastScreenTargets = [];
	hideFocusGlow();
}

/** Berry may only open hosts written in the user message. */
export function setBerryUrlAllowlist(hosts: readonly string[]): void {
	allowedHosts = new Set(hosts.map((host) => host.toLowerCase()));
}

export function berryUrlAllowed(url: string): boolean {
	if (!allowedHosts) return true;
	let host = "";
	try {
		host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return false;
	}
	for (const allowed of allowedHosts) {
		if (host === allowed || host.endsWith(`.${allowed}`)) return true;
	}
	return false;
}

/** After the site is already open, refuse tools that switch windows. */
export function lockBerryBrowser(): void {
	browserLocked = true;
}

/** Returns an error string when the model should stop, otherwise null. */
export function takeBerryScreenAction(name: string): string | null {
	if (browserLocked && NAVIGATE_TOOLS.has(name)) {
		return "Stay in this window and continue the task. Do not switch apps. Do not ask the user to do the next step.";
	}
	screenActions += 1;
	if (screenActions > SCREEN_ACTION_LIMIT) {
		return "Out of steps. Say what you actually finished. Do not ask the user to do the rest.";
	}
	return null;
}

function screenGuard(name: string): ReturnType<typeof errorResult> | undefined {
	const stop = takeBerryScreenAction(name);
	if (!stop) return undefined;
	return errorResult(stop);
}

/** Mouse, keyboard, and screen look — so Berry can act in the browser and other apps. */
export function createBerryComputerTools(): McpToolDefinition[] {
	return [
		{
			name: "list_browser_tabs",
			description:
				"List browser windows already on screen, including Arc. Arc is a browser. Call this before open_url. If the site is listed, use focus_browser_tab instead of opening a new tab.",
			annotations: LOOK_ANNOTATIONS,
			inputSchema: { type: "object", properties: {} },
			async handler() {
				const blocked = screenGuard("list_browser_tabs");
				if (blocked) return blocked;
				try {
					return textResult(await listBrowserTabs());
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
		{
			name: "focus_browser_tab",
			description:
				"Bring an already-open browser window to the front, including Arc. Match the window title, for example Canva. Does not open a new tab. Arc is the browser, not a separate app from the page inside it.",
			annotations: SCREEN_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "Part of the tab title or URL.",
					},
				},
				required: ["query"],
			},
			async handler(raw) {
				const blocked = screenGuard("focus_browser_tab");
				if (blocked) return blocked;
				try {
					const query = typeof raw.query === "string" ? raw.query : "";
					const text = await focusBrowserTab(query);
					if (text.startsWith("Brought ")) lockBerryBrowser();
					return textResult(text);
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
		{
			name: "look_at_screen",
			description:
				"Read text on the browser window and return ids (L1, L2…). Call once, then click or click_and_type by those ids. Do not call this after every click.",
			annotations: LOOK_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description:
							"Optional window title to capture, for example Canva. Omit to use the front browser window.",
					},
				},
			},
			async handler(raw) {
				const blocked = screenGuard("look_at_screen");
				if (blocked) return blocked;
				try {
					const query = typeof raw.query === "string" ? raw.query : undefined;
					return textResult(await lookAtScreen({ query }));
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
		{
			name: "click_and_type",
			description:
				"Click a field by id from look_at_screen (or x,y), then type into it. Use this for search boxes and title fields. Do not look at the screen first if you already have ids.",
			annotations: SCREEN_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					id: {
						type: "string",
						description: "Target id from look_at_screen, such as L12 or search.",
					},
					x: { type: "number" },
					y: { type: "number" },
					text: { type: "string" },
				},
				required: ["text"],
			},
			async handler(raw) {
				const blocked = screenGuard("click_and_type");
				if (blocked) return blocked;
				try {
					const text = typeof raw.text === "string" ? raw.text : "";
					const point = clickPointFromRaw(raw);
					await clickAndType(point.x, point.y, text);
					return textResult(`Clicked and typed ${text.length} characters. Continue the task.`);
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
		{
			name: "click",
			description:
				"Click a control by id from look_at_screen (L12) or by x,y. For a text field, use click_and_type. Do not look at the screen after this. Do not click password fields, Log out, or Post/Publish unless the user asked to publish.",
			annotations: SCREEN_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					id: { type: "string", description: "Target id from look_at_screen." },
					x: { type: "number" },
					y: { type: "number" },
				},
			},
			async handler(raw) {
				const blocked = screenGuard("click");
				if (blocked) return blocked;
				try {
					const point = clickPointFromRaw(raw);
					await clickAt(point.x, point.y);
					return textResult(
						`Clicked ${Math.round(point.x)},${Math.round(point.y)}. Continue the task.`,
					);
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
		{
			name: "type_text",
			description:
				"Type into the control that already has focus. Prefer click_and_type when you still need to click the field. Do not type passwords.",
			annotations: SCREEN_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: { text: { type: "string" } },
				required: ["text"],
			},
			async handler(raw) {
				const blocked = screenGuard("type_text");
				if (blocked) return blocked;
				try {
					const text = typeof raw.text === "string" ? raw.text : "";
					await typeText(text);
					return textResult(`Typed ${text.length} characters.`);
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
		{
			name: "press_key",
			description:
				"Press a key, optionally with command, shift, option, or control. Names: return, tab, escape, space, delete, left, right, up, down.",
			annotations: SCREEN_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: {
					key: { type: "string" },
					modifiers: { type: "array", items: { type: "string" } },
				},
				required: ["key"],
			},
			async handler(raw) {
				const blocked = screenGuard("press_key");
				if (blocked) return blocked;
				try {
					const key = typeof raw.key === "string" ? raw.key : "";
					const modifiers = Array.isArray(raw.modifiers)
						? raw.modifiers.filter((item): item is string => typeof item === "string")
						: [];
					await pressKey(key, modifiers);
					return textResult(`Pressed ${key}.`);
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
		{
			name: "scroll_screen",
			description:
				"Scroll the front window. Positive dy scrolls up; negative scrolls down. Typical step is 3 to 8.",
			annotations: SCREEN_ANNOTATIONS,
			inputSchema: {
				type: "object",
				properties: { dy: { type: "number" } },
				required: ["dy"],
			},
			async handler(raw) {
				const blocked = screenGuard("scroll_screen");
				if (blocked) return blocked;
				try {
					await scrollScreen(asNumber(raw.dy));
					return textResult("Scrolled.");
				} catch (err) {
					return errorResult(err instanceof Error ? err.message : String(err));
				}
			},
		},
	];
}
