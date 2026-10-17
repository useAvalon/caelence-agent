import {
	extractMentionedSite,
	extractScreenShortcutInput,
	messageNeedsCreatedContent,
	stripBerryModeBanner,
} from "../decisions/screen-shortcut.ts";
import { planScreenWork } from "./plan.ts";
import { listRoutines } from "./routines.ts";

export type ComputerRoute =
	| { kind: "direct"; tool: "open_url" | "open_app" | "use_routine"; arg: string; reply: string }
	| { kind: "simple" }
	| { kind: "complex" }
	| { kind: "chat" };

const UI_TASK =
	/\b(click|type|scroll|tab|search|select|open|switch|dismiss|close|textbox|text area|textarea|on screen)\b/i;

export function routeComputerTask(
	raw: string,
	context: { routines?: Array<{ name: string }> } = {},
): ComputerRoute {
	const message = stripBerryModeBanner(raw);
	const routines = context.routines ?? listRoutines();
	const named = routines.find((item) => message.toLowerCase().includes(item.name.toLowerCase()));
	if (named && /\b(run|replay|do|use)\b/i.test(message)) {
		return {
			kind: "direct",
			tool: "use_routine",
			arg: named.name,
			reply: `Running ${named.name}.`,
		};
	}

	const appPlan = extractScreenShortcutInput("open_app", message);
	const appName = appPlan?.input.name?.trim() ?? "";
	if (
		appPlan?.toolName === "open_app" &&
		/^(open|launch)\b/i.test(message.trim()) &&
		isMacAppName(appName)
	) {
		return {
			kind: "direct",
			tool: "open_app",
			arg: appName,
			reply: appPlan.reply,
		};
	}

	const url = extractMentionedSite(message);
	if (
		url &&
		!messageNeedsCreatedContent(message) &&
		/^(open|go to|visit)\b/i.test(message.trim())
	) {
		return { kind: "direct", tool: "open_url", arg: url, reply: `Opened ${url}.` };
	}

	const work = planScreenWork(message);
	if (work.put === "catalog" || work.put === "site" || work.put === "app")
		return { kind: "complex" };
	if (work.source === "front") return { kind: "simple" };

	if (UI_TASK.test(message)) return { kind: "simple" };
	return { kind: "chat" };
}

const MAC_APPS =
	/^(notes|mail|finder|music|calendar|messages|safari|preview|terminal|textedit|system settings|settings)$/i;

function isMacAppName(name: string): boolean {
	return MAC_APPS.test(name.replace(/\.app$/i, "").trim());
}
