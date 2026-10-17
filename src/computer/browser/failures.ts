import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runsDir } from "../telemetry.ts";

export function failureDir(runId: string | undefined): string {
	const id = `${Date.now()}`;
	return join(runsDir(), runId || "browser", "failures", id);
}

export async function recordFailure(input: {
	runId?: string;
	action: unknown;
	error: unknown;
	url?: string;
	snapshotUsed?: string;
	freshSnapshot?: string;
	diagnostics?: unknown;
	screenshot?: (file: string) => Promise<void>;
}): Promise<void> {
	try {
		const base = failureDir(input.runId);
		await mkdir(base, { recursive: true });
		await Promise.all([
			writeFile(
				join(base, "record.json"),
				JSON.stringify(
					{
						action: input.action,
						error: input.error instanceof Error ? input.error.message : String(input.error),
						url: input.url ?? "",
						diagnostics: input.diagnostics ?? null,
						snapshotUsed: input.snapshotUsed ?? "",
					},
					null,
					2,
				),
			),
			writeFile(join(base, "snapshot.txt"), input.freshSnapshot || "snapshot failed"),
			input.screenshot ? input.screenshot(join(base, "screen.png")) : Promise.resolve(),
		]);
	} catch {
		// A missed diagnostic must not hide the original action error.
	}
}
