import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type LadderRung = "mcp" | "webmcp" | "code" | "ui" | "take";

export interface TurnTelemetry {
	at: string;
	turn: number;
	tier: 1 | 2;
	llmMs: number;
	actions: number;
	tokensIn?: number;
	tokensOut?: number;
	lastFail?: string;
	frameAgeMs?: number;
	role?: string;
	model?: string;
	ladder?: LadderRung;
}

export function runsDir(): string {
	return join(homedir(), ".agent", "runs");
}

export function appendRunLog(runId: string | undefined, row: TurnTelemetry): void {
	if (!runId) return;
	try {
		mkdirSync(runsDir(), { recursive: true });
		appendFileSync(join(runsDir(), `${runId}.jsonl`), `${JSON.stringify(row)}\n`);
	} catch {
		// Local telemetry only; a write miss must not stop the task.
	}
}
