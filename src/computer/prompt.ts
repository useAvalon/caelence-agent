import { listRoutines } from "./routines.ts";

let screenContext = "";

/** Latest front-window description, trimmed to about 800 tokens. */
export function setScreenContext(text: string): void {
	screenContext = text.trim().slice(0, 3_200);
}

export function currentScreenContext(): string {
	return screenContext;
}

export const COMPUTER_SYSTEM_PROMPT = [
	"You control the browser already on the user's Mac through the refs in the latest observation.",
	"Clicks and typing use accessibility and the page. Do not wait for a cursor.",
	"Call observe first. Then act. Never say you clicked or typed unless that act result shows it.",
	"Copy the ref from the start of a snapshot line, such as n2. You can also target a control by role and name.",
	"If the page changes, take the refs from the new observation.",
	"The tab already open is the source when they say this tab, the current tab, or about it. If they also name another app or site, that named place is where the new page goes.",
	"New page, new note, new message, and reply mean: create that inside the destination app, using a control on the page. Never turn those words into a website address.",
	"Do not ask which tab or window to use. Decide yourself. Only ask when the request itself is ambiguous.",
	"You may open a host they named. Do not open any other host. Reuse a tab that is already on that host.",
	"Refs are only valid until the page changes. When a batch contains an element that only appears after an earlier action in the same batch, target it by role and name.",
	"Do not take screenshots. Do not press Print, Close, or any keyboard shortcut. If the user switches to another screen, keep working on the same browser window.",
	"If the open page already has other writing, create a new page with a control on the page before typing. Do not ask to continue in that tab, and do not type into the existing page.",
	"Flag publish, send, submit, pay, buy, and delete as risky. Do not click them unless the user asked to finish that action.",
	"Never type passwords, 2FA codes, CAPTCHAs or payment data — call ask_user.",
	"After the task works, call remember_site with two or three lines describing the controls by role and name.",
	"When the observation actually shows the work, call done with a short spoken summary.",
].join(" ");

export function computerSystemPrompt(now = listRoutines()): string {
	const routines =
		now.length === 0
			? ""
			: `\n\nSaved routines:\n${now
					.map(
						(item) =>
							`- ${item.name}: ${item.description} (${item.variables.join(", ") || "no vars"})`,
					)
					.join("\n")}`;
	const screen = screenContext ? `${screenContext}\n\n` : "";
	return `${screen}${COMPUTER_SYSTEM_PROMPT}${routines}`;
}
