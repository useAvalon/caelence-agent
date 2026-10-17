import type { BrowserAction } from "./session.ts";

export interface PageSignature {
	modal: boolean;
	count: number;
	url: string;
	focused?: boolean;
}

export function signatureChanged(before: PageSignature, after: PageSignature): boolean {
	return (
		before.modal !== after.modal ||
		before.url !== after.url ||
		Math.abs(before.count - after.count) > 5
	);
}

/** Refs from the previous snapshot are unsafe after a structural change. Role and name are not. */
export function laterActionsUseRefs(actions: readonly BrowserAction[], index: number): boolean {
	return actions.slice(index + 1).some((action) => {
		if (
			action.kind === "scroll" ||
			action.kind === "press" ||
			action.kind === "navigate" ||
			action.kind === "click_xy"
		) {
			return false;
		}
		return !(action.role && action.name);
	});
}

export function normField(value: string): string {
	return value
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
