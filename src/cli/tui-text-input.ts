export interface TextInputKey {
	return?: boolean;
	escape?: boolean;
	tab?: boolean;
	upArrow?: boolean;
	downArrow?: boolean;
	leftArrow?: boolean;
	rightArrow?: boolean;
	backspace?: boolean;
	delete?: boolean;
	ctrl?: boolean;
	meta?: boolean;
}

function normalizePaste(input: string): string {
	if (!input.includes("\n") && !input.includes("\r")) return input;
	return input.replace(/\r\n|\r|\n/g, " ");
}

export function applyTextInputKey(
	value: string,
	cursor: number,
	input: string,
	key: TextInputKey,
): { value: string; cursor: number; submit?: boolean } | undefined {
	if (key.return) return { value, cursor, submit: true };
	// Ink maps Mac backspace (\\x7f) to key.delete; treat both as delete-left.
	if (key.backspace || key.delete || input === "\x7f" || input === "\b") {
		if (cursor === 0) return { value, cursor };
		return { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
	}
	if (key.escape || key.tab || key.upArrow || key.downArrow || key.ctrl || key.meta) {
		return undefined;
	}
	if (key.leftArrow) return { value, cursor: Math.max(0, cursor - 1) };
	if (key.rightArrow) return { value, cursor: Math.min(value.length, cursor + 1) };
	if (!input) return undefined;
	const text = normalizePaste(input);
	if (!text) return undefined;
	return {
		value: value.slice(0, cursor) + text + value.slice(cursor),
		cursor: cursor + text.length,
	};
}
