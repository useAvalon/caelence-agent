import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const APP_NAME = /^[\p{L}\p{N} ._&+-]{1,80}$/u;

export async function openApp(name: string): Promise<string> {
	const trimmed = name.trim();
	if (!APP_NAME.test(trimmed)) throw new Error("name must be a plain app name");
	spawn("/usr/bin/open", ["-a", trimmed], { detached: true, stdio: "ignore" }).unref();
	return `Opened ${trimmed}.`;
}

export async function runAppleScript(source: string): Promise<string> {
	if (source.length > 8_000) throw new Error("AppleScript is too long.");
	const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", source], { timeout: 8_000 });
	return stdout.trim() || "ok";
}

export async function runShell(command: string): Promise<string> {
	if (command.length > 4_000) throw new Error("command is too long.");
	const { stdout, stderr } = await execFileAsync("/bin/zsh", ["-lc", command], {
		timeout: 15_000,
		maxBuffer: 500_000,
	});
	return (stdout + stderr).trim() || "ok";
}
