export function stepIndex(index: number, count: number, delta: number): number {
	if (count <= 0) return 0;
	return (index + delta + count) % count;
}

export type PickerKeyAction =
	| { type: "move"; delta: number }
	| { type: "confirm" }
	| { type: "cancel" }
	| { type: "block" };

/** Keys that belong to an open command list, not the composer. */
export function pickerKeyAction(key: string, shiftKey = false): PickerKeyAction | null {
	if (key === "ArrowDown" || (key === "Tab" && !shiftKey)) return { type: "move", delta: 1 };
	if (key === "ArrowUp" || (key === "Tab" && shiftKey)) return { type: "move", delta: -1 };
	if (key === "Enter") return { type: "confirm" };
	if (key === "Escape") return { type: "cancel" };
	if (key.length === 1 || key === "Backspace" || key === "Delete") return { type: "block" };
	return null;
}

export function pickerStartIndex(items: Array<{ id: string }>, currentId?: string): number {
	if (!currentId) return 0;
	const index = items.findIndex((item) => item.id === currentId);
	return index >= 0 ? index : 0;
}
