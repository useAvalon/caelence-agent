export class StaleRefError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StaleRefError";
	}
}

export class NotHittableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NotHittableError";
	}
}

export class FocusError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FocusError";
	}
}

export class PostconditionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PostconditionError";
	}
}

const HINTS: Array<[new (...args: never[]) => Error, string]> = [
	[
		StaleRefError,
		"The element is gone or the page changed. Use refs from the snapshot below, or a role and name target.",
	],
	[
		NotHittableError,
		"Something covers the element. Close the covering element first or pick another control.",
	],
	[
		FocusError,
		"The field would not take focus. Click a different part of the field or check for a blocking dialog.",
	],
	[
		PostconditionError,
		"The action ran but did not have the expected effect. Check the snapshot below.",
	],
];

export function hintFor(err: unknown): string {
	for (const [type, hint] of HINTS) {
		if (err instanceof type) return hint;
	}
	return "Unexpected error.";
}
