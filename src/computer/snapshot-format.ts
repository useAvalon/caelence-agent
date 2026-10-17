export interface SnapshotLine {
	ref: string;
	role: string;
	name: string;
	flags: string[];
}

export function formatSnapshotLine(line: SnapshotLine): string {
	const flag = line.flags.length > 0 ? ` (${line.flags.join(", ")})` : "";
	const name = line.name.replace(/\s+/g, " ").trim().slice(0, 70);
	return `[${line.ref}] ${line.role} ${JSON.stringify(name)}${flag}`;
}

export function parseSnapshotLine(text: string): SnapshotLine | undefined {
	const modern = text.match(/^\[([^\]]+)\]\s+(\S+)\s+("(?:\\.|[^"\\])*")(?:\s+\(([^)]*)\))?$/);
	const legacy = text.match(/^(\S+)\s+(\S+)\s+("(?:\\.|[^"\\])*")(?:\s+\[([^\]]*)\])?$/);
	const match = modern ?? legacy;
	if (!match) return undefined;
	const flags = (match[4] ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	try {
		return {
			ref: match[1] ?? "",
			role: match[2] ?? "",
			name: JSON.parse(match[3] ?? '""') as string,
			flags,
		};
	} catch {
		return undefined;
	}
}

export function snapshotLines(text: string): string[] {
	const idx = text.indexOf("\n");
	const body = idx >= 0 ? text.slice(idx + 1) : "";
	return body.split("\n").filter((line) => line.trim().length > 0 && !line.startsWith("#"));
}

const COMPOSE_NAME =
	/\b(start a post|create a post|share an update|start posting|share your thoughts|new post)\b/i;

export function composeRefFromSnapshot(text: string): string | undefined {
	for (const line of snapshotLines(text)) {
		const parsed = parseSnapshotLine(line);
		if (!parsed) continue;
		if (COMPOSE_NAME.test(parsed.name)) return parsed.ref;
	}
	return undefined;
}

/** Match a model target to a ref already printed in the snapshot. */
export function refForAction(
	snapshot: string,
	action: { ref?: string; role?: string; name?: string; label?: string; kind: string },
): string | undefined {
	const lines = snapshotLines(snapshot)
		.map(parseSnapshotLine)
		.filter((line): line is SnapshotLine => Boolean(line));
	if (action.ref) {
		const raw = action.ref.replace(/^\[|\]$/g, "");
		const hit = lines.find((line) => line.ref === raw || line.ref === `n${raw}`);
		if (hit) return hit.ref;
	}
	const want = (action.name || (action.label && action.label !== action.kind ? action.label : ""))
		.trim()
		.toLowerCase();
	if (!want) return undefined;
	const matches = lines.filter((line) => {
		if (action.role && line.role !== action.role) return false;
		const have = line.name.toLowerCase();
		return have === want || have.includes(want);
	});
	matches.sort((a, b) => a.name.length - b.name.length);
	return matches[0]?.ref;
}
