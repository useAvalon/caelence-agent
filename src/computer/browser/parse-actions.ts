import type { BrowserAction, BrowserActionKind } from "./session.ts";

const KINDS = new Set<BrowserActionKind>([
	"click",
	"type",
	"select",
	"press",
	"scroll",
	"navigate",
	"click_xy",
]);

const KIND_ALIAS: Record<string, BrowserActionKind> = {
	press_key: "press",
	key: "press",
	key_combination: "press",
	hotkey: "press",
	keypress: "press",
};

const EXPECTS = new Set(["dialog_opens", "focus_inside", "text_equals", "url_changes", "none"]);

export interface ParsedActions {
	actions: BrowserAction[];
	error?: string;
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function refField(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return stringField(value);
}

/** Reject unknown actions before they touch the page. */
export function parseBrowserActions(raw: unknown): ParsedActions {
	if (!Array.isArray(raw)) return { actions: [], error: "act.actions must be an array." };
	const actions: BrowserAction[] = [];
	for (const [index, item] of raw.entries()) {
		if (!item || typeof item !== "object") {
			return { actions: [], error: `Action ${index} is not an object.` };
		}
		const rec = item as Record<string, unknown>;
		const rawKind = typeof rec.kind === "string" ? rec.kind : "";
		const kind = KIND_ALIAS[rawKind] ?? rawKind;
		if (!KINDS.has(kind as BrowserActionKind)) {
			return { actions: [], error: `Action ${index} has unknown kind "${rawKind || "missing"}".` };
		}
		const target =
			rec.target && typeof rec.target === "object"
				? (rec.target as Record<string, unknown>)
				: undefined;
		const ref =
			refField(rec.ref) ??
			refField(target?.ref) ??
			(typeof rec.target === "string" ? refField(rec.target) : undefined);
		const role = stringField(rec.role) ?? stringField(target?.role);
		const name = stringField(rec.name) ?? stringField(target?.name);
		const label = (stringField(rec.label) ?? kind).slice(0, 60);
		const expect = stringField(rec.expect);
		if (expect && !EXPECTS.has(expect)) {
			return { actions: [], error: `Action ${index} has unknown expect "${expect}".` };
		}
		const needsTarget = kind === "click" || kind === "select";
		let resolvedRole = role;
		let resolvedName = name;
		if (needsTarget && !ref && !(resolvedRole && resolvedName)) {
			const fallback = stringField(rec.label);
			if (fallback && fallback !== kind) {
				resolvedName = fallback;
				resolvedRole = kind === "select" ? "textbox" : "button";
			}
		}
		if (needsTarget && !ref && !(resolvedRole && resolvedName)) {
			return {
				actions: [],
				error: `Action ${index} (${label}) needs a ref or a role and name.`,
			};
		}
		if ((kind === "type" || kind === "select") && typeof rec.text !== "string") {
			return { actions: [], error: `Action ${index} (${label}) needs text.` };
		}
		if (kind === "press" && typeof rec.key !== "string") {
			return { actions: [], error: `Action ${index} (${label}) needs a key.` };
		}
		if (kind === "navigate" && typeof rec.url !== "string") {
			return { actions: [], error: `Action ${index} (${label}) needs a url.` };
		}
		actions.push({
			kind: kind as BrowserActionKind,
			label,
			ref,
			role: resolvedRole,
			name: resolvedName,
			text: typeof rec.text === "string" ? rec.text : undefined,
			key: typeof rec.key === "string" ? rec.key : undefined,
			url: typeof rec.url === "string" ? rec.url : undefined,
			x: typeof rec.x === "number" ? rec.x : undefined,
			y: typeof rec.y === "number" ? rec.y : undefined,
			risky: rec.risky === true,
			expect: expect as BrowserAction["expect"],
		});
	}
	return { actions };
}
