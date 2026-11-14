/**
 * The verbs the current turn's `status` event carried. The thinking label reads them while it
 * renders. They live outside React state because the label sits several layers below the place
 * events arrive, and they change once per turn.
 */
let verbs: readonly string[] = [];

export function setTurnVerbs(next: readonly string[]): void {
	verbs = next.filter((verb) => verb.trim().length > 0);
}

export function turnVerbs(): readonly string[] {
	return verbs;
}
