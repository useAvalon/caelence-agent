import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Types into the focused control with System Events. Does not click or refocus. */
export async function typeWithSystemEvents(text: string, app?: string): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "caelence-type-"));
	const file = join(dir, "text.txt");
	try {
		await writeFile(file, text, "utf8");
		const posix = file.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
		const front = app
			? `tell application "System Events" to set frontmost of process "${app.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" to true\n`
			: "";
		const source = `${front}set theText to read POSIX file "${posix}" as «class utf8»
tell application "System Events"
  repeat with i from 1 to count of characters of theText
    set c to character i of theText
    if c is return or c is linefeed then
      key code 36
    else
      keystroke c
    end if
    delay 0.003
  end repeat
end tell`;
		await run("/usr/bin/osascript", ["-e", source], { timeout: 30_000 });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
