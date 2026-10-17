const COMPOSE =
	/\b(start a post|create a post|write a post|draft|composer|textbox|text field|post field|post box)\b/i;

const PUBLISH = /\b(publish|submit|pay|buy|order|delete|remove|purchase|post now|share now)\b/i;

/** The publish control named "Post", not "Start a post" / "create a post". */
const POST_BUTTON = /^(click\s+)?post$/i;

const SEND = /\bsend\b/i;

const DESTRUCTIVE_SHELL = /\b(rm\s|sudo\s|curl\s[^\n]*\|\s*(ba)?sh|git\s+push|mkfs|dd\s+if=)/i;

export function labelLooksRisky(label: string): boolean {
	const text = label.trim();
	if (!text) return false;
	if (COMPOSE.test(text)) return false;
	if (PUBLISH.test(text)) return true;
	if (POST_BUTTON.test(text)) return true;
	if (SEND.test(text)) return true;
	return false;
}

export function actionNeedsConfirm(input: {
	risky?: boolean;
	label: string;
	name?: string;
}): boolean {
	if (input.name && POST_BUTTON.test(input.name.trim())) return true;
	if (input.risky === true && !COMPOSE.test(input.label)) return true;
	return labelLooksRisky(input.label);
}

export function shellNeedsConfirm(command: string): boolean {
	return DESTRUCTIVE_SHELL.test(command);
}

export function httpNeedsConfirm(method: string): boolean {
	return /^(POST|PUT|PATCH|DELETE)$/i.test(method.trim());
}

const SAFE_KEY = /^(enter|return|escape|esc|tab|backspace|delete|space)$/i;
const DISRUPTIVE =
	/\b(print|udskriv|close tab|close window|luk|quit|log out|new tab|reload|genindlæs)\b/i;

/** Clicks and keys that steal the keyboard or destroy the tab. */
export function actionIsDisruptive(action: {
	kind: string;
	label: string;
	name?: string;
	key?: string;
}): boolean {
	if (DISRUPTIVE.test(`${action.label} ${action.name ?? ""}`)) return true;
	if (action.kind === "press") {
		const key = action.key?.trim() ?? "";
		if (!SAFE_KEY.test(key)) return true;
	}
	return false;
}
export function mustAskUser(text: string): boolean {
	return /\b(password|2fa|two[- ]factor|captcha|cvv|card number|one[- ]time code)\b/i.test(text);
}
