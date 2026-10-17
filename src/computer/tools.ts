import { parseBrowserActions } from "./browser/parse-actions.ts";
import type { BrowserAction, BrowserSession } from "./browser/session.ts";
import { nativeBridge } from "./native/client.ts";
import { listRoutines } from "./routines.ts";
import {
	actionIsDisruptive,
	actionNeedsConfirm,
	mustAskUser,
	shellNeedsConfirm,
} from "./safety.ts";
import { openApp, runAppleScript, runShell } from "./shell.ts";

export type ObserveMode = "browser" | "native" | "screenshot";

export interface ComputerRuntime {
	observe(mode: ObserveMode, app?: string): Promise<string>;
	act(actions: BrowserAction[]): Promise<{ observation: string; stopped?: string }>;
	run(tool: string, arg: string): Promise<string>;
	askUser(question: string): Promise<string>;
}

export function createComputerRuntime(
	browser: BrowserSession,
	options: { autoApprove?: boolean; stayInApp?: string } = {},
): ComputerRuntime {
	const autoApprove = options.autoApprove === true;
	const stayInApp = options.stayInApp?.trim() || undefined;
	return {
		async observe(_mode, app) {
			if (stayInApp) return nativeBridge.snapshot(stayInApp);
			if (_mode === "native" || _mode === "screenshot") return nativeBridge.snapshot(app);
			await browser.connect();
			return browser.snapshot();
		},
		async act(actions) {
			if (stayInApp) {
				const snap = await nativeBridge.snapshot(stayInApp);
				if (actions.some((action) => action.kind === "navigate" || action.url)) {
					return { observation: snap, stopped: `Stay in ${stayInApp}. Do not open a website.` };
				}
				return { observation: snap };
			}
			const allowed: BrowserAction[] = [];
			for (const action of actions) {
				if (actionIsDisruptive(action)) {
					return {
						observation: "",
						stopped: "I will not press print, close the tab, or send a keyboard shortcut.",
					};
				}
				if (mustAskUser(`${action.label} ${action.text ?? ""}`)) {
					return { observation: "", stopped: "ask_user: credentials or challenge" };
				}
				if (!autoApprove && actionNeedsConfirm(action)) {
					const choice = await nativeBridge.confirm(action.label);
					if (choice === "stop") return { observation: "", stopped: "stop" };
					if (choice === "decline") {
						return {
							observation: `User declined: "${action.label}". Do not repeat it. Choose a different approach that still fulfills the request, or ask_user one short question if the request is unclear.`,
						};
					}
				}
				if (action.kind.startsWith("native_")) continue;
				allowed.push(action);
			}
			await browser.connect();
			return browser.act(allowed);
		},
		async run(tool, arg) {
			if (tool === "open_app") return openApp(arg);
			if (tool === "applescript" || tool === "shell") {
				if (/javascript|queryselector|execute |keystroke|tell application|osascript/i.test(arg)) {
					return "That cannot control this page. Use act with a ref from the latest observation. Do not type into a document that already has text.";
				}
			}
			if (tool === "applescript") {
				if (!autoApprove && shellNeedsConfirm(arg)) {
					const choice = await nativeBridge.confirm(arg.slice(0, 80));
					if (choice === "stop") return "STOP_TASK";
					if (choice === "decline") {
						return `User declined: "${arg.slice(0, 80)}". Do not repeat it. Choose a different approach that still fulfills the request.`;
					}
				}
				return runAppleScript(arg);
			}
			if (tool === "shell") {
				if (!autoApprove && shellNeedsConfirm(arg)) {
					const choice = await nativeBridge.confirm(arg.slice(0, 80));
					if (choice === "stop") return "STOP_TASK";
					if (choice === "decline") {
						return `User declined: "${arg.slice(0, 80)}". Do not repeat it. Choose a different approach that still fulfills the request.`;
					}
				}
				return runShell(arg);
			}
			if (tool === "use_routine") {
				const found = listRoutines().find((item) => item.name === arg);
				if (!found) return `No routine named ${arg}.`;
				return `Routine ${found.name} has ${found.steps.length} steps.`;
			}
			return `Unknown run tool ${tool}.`;
		},
		async askUser(question) {
			await nativeBridge.status(question);
			return `Asked the user: ${question}`;
		},
	};
}

export const COMPUTER_TOOL_SCHEMAS = [
	{
		name: "observe",
		description:
			"Current UI state. browser, native, or screenshot. Use at start or after context loss.",
		inputSchema: {
			type: "object",
			properties: {
				mode: { type: "string", enum: ["browser", "native", "screenshot"] },
				app: { type: "string" },
			},
			required: ["mode"],
		},
	},
	{
		name: "act",
		description:
			"Batch of UI actions. Each item needs kind and label. Target a ref from the latest observation, or {role, name} for a control that appears later in the same batch. Optional expect: dialog_opens, focus_inside, text_equals, url_changes.",
		inputSchema: {
			type: "object",
			properties: {
				actions: { type: "array", items: { type: "object" } },
			},
			required: ["actions"],
		},
	},
	{
		name: "run",
		description:
			"Open an app or replay a saved routine. Do not use this to click or type in a web page.",
		inputSchema: {
			type: "object",
			properties: {
				tool: { type: "string" },
				arg: { type: "string" },
			},
			required: ["tool", "arg"],
		},
	},
	{
		name: "http",
		description:
			"Replay a captured site request. Confirm mutating methods. Not for sites that prohibit automation.",
		inputSchema: {
			type: "object",
			properties: {
				captureId: { type: "string" },
				method: { type: "string" },
				params: { type: "object" },
			},
			required: ["captureId"],
		},
	},
	{
		name: "remember_site",
		description:
			"After a task succeeds, save two or three lines about this site using roles and names from the snapshot.",
		inputSchema: {
			type: "object",
			properties: { note: { type: "string" } },
			required: ["note"],
		},
	},
	{
		name: "ask_user",
		description: "Clarify, or hand over for passwords, 2FA, CAPTCHA, or payment.",
		inputSchema: {
			type: "object",
			properties: { question: { type: "string" } },
			required: ["question"],
		},
	},
	{
		name: "done",
		description: "Finish. summary is spoken once.",
		inputSchema: {
			type: "object",
			properties: {
				summary: { type: "string" },
				success: { type: "boolean" },
			},
			required: ["summary", "success"],
		},
	},
] as const;

export function asBrowserActions(raw: unknown): BrowserAction[] {
	return parseBrowserActions(raw).actions;
}
