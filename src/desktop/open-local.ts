import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export function resolveLocalPath(raw: string, cwd?: string): string | undefined {
	let path = raw.trim();
	if (!path || path.includes("\0") || /\n|\r/.test(path)) return undefined;
	if (path.startsWith("file://")) {
		try {
			const url = new URL(path);
			if (url.protocol !== "file:") return undefined;
			path = decodeURIComponent(url.pathname);
			if (process.platform === "win32" && path.startsWith("/")) path = path.slice(1);
		} catch {
			return undefined;
		}
	}
	if (path === "~") path = homedir();
	else if (path.startsWith("~/")) path = `${homedir()}/${path.slice(2)}`;
	if (!isAbsolute(path)) {
		if (!cwd) return undefined;
		path = resolve(cwd, path);
	}
	if (!existsSync(path)) return undefined;
	return path;
}

export function localOpenCommand(
	absPath: string,
	reveal: boolean,
): { cmd: string; args: string[] } {
	if (process.platform === "darwin") {
		return reveal
			? { cmd: "/usr/bin/open", args: ["-R", absPath] }
			: { cmd: "/usr/bin/open", args: [absPath] };
	}
	if (process.platform === "win32") {
		return reveal
			? { cmd: "explorer", args: ["/select,", absPath] }
			: { cmd: "cmd", args: ["/c", "start", "", absPath] };
	}
	if (reveal) {
		return { cmd: "xdg-open", args: [resolve(absPath, "..")] };
	}
	return { cmd: "xdg-open", args: [absPath] };
}

export function openResolvedPath(absPath: string, reveal = false): void {
	const { cmd, args } = localOpenCommand(absPath, reveal);
	spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}
