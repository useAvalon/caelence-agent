import type { StreamLine } from "./tui-stream.ts";

export function estimateWrappedRows(text: string, width: number): number {
	const cols = Math.max(1, width);
	const parts = text.split("\n");
	let rows = 0;
	for (const part of parts) {
		const len = part.length;
		rows += len === 0 ? 1 : Math.ceil(len / cols);
	}
	return Math.max(1, rows);
}

export function estimateStreamLineRows(line: StreamLine, width: number): number {
	const labelRows = 1;
	switch (line.type) {
		case "user":
		case "assistant":
		case "thought":
			return labelRows + estimateWrappedRows(line.text, width);
		case "tool":
			return line.error ? 2 : 1;
		case "system":
		case "error":
		case "todos":
			return estimateWrappedRows(line.text, width);
	}
}

/** Keep the newest transcript lines that fit the row budget (wrapped height). */
export function takeLinesForRowBudget(
	lines: readonly StreamLine[],
	width: number,
	maxRows: number,
): StreamLine[] {
	if (maxRows <= 0 || lines.length === 0) return [];
	const picked: StreamLine[] = [];
	let used = 0;
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]!;
		const need = estimateStreamLineRows(line, width);
		if (used + need > maxRows && picked.length > 0) break;
		picked.unshift(line);
		used += need;
	}
	return picked;
}

export function summarizeTurnTools(
	tools: ReadonlyArray<{ name: string; status: "running" | "ok" | "fail" }>,
): string {
	if (tools.length === 0) return "";
	const counts = new Map<string, number>();
	for (const tool of tools) {
		counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
	}
	const parts = [...counts.entries()].map(([name, n]) => (n > 1 ? `${name}×${n}` : name));
	return `Tools: ${parts.join(", ")}`;
}
