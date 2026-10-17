import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function debugDir(): string {
	return join(homedir(), ".agent", "debug");
}

export function appendDebugTurn(runId: string | undefined, entry: object): void {
	try {
		const dir = debugDir();
		mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, `${runId || "browser"}.jsonl`), `${JSON.stringify(entry)}\n`);
	} catch {
		// A missed debug line must not stop the task.
	}
}
