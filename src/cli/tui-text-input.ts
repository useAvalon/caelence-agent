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

export function applyTextInputKey(
	value: string,
	cursor: number,
	input: string,
	key: TextInputKey,
): { value: string; cursor: number; submit?: boolean } | undefined {
	if (key.return) return { value, cursor, submit: true };
	if (key.escape || key.tab || key.upArrow || key.downArrow || key.ctrl || key.meta) {
		return undefined;
	}
	if (key.leftArrow) return { value, cursor: Math.max(0, cursor - 1) };
	if (key.rightArrow) return { value, cursor: Math.min(value.length, cursor + 1) };
	if (key.backspace) {
		if (cursor === 0) return { value, cursor };
		return { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
	}
	if (key.delete) {
		if (cursor >= value.length) return { value, cursor };
		return { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor };
	}
	if (!input) return undefined;
	return {
		value: value.slice(0, cursor) + input + value.slice(cursor),
		cursor: cursor + input.length,
	};
}
