type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
	debug(msg: string, extra?: Record<string, unknown>): void;
	info(msg: string, extra?: Record<string, unknown>): void;
	warn(msg: string, extra?: Record<string, unknown>): void;
	error(msg: string, extra?: Record<string, unknown>): void;
	child(scope: string): Logger;
}

function emit(level: Level, scope: string, msg: string, extra?: Record<string, unknown>): void {
	const line = JSON.stringify({
		t: new Date().toISOString(),
		level,
		scope,
		msg,
		...(extra ? { data: extra } : {}),
	});
	// stderr so a TUI on stdout is not corrupted
	if (level === "error") process.stderr.write(`${line}\n`);
	else if (level === "warn") process.stderr.write(`${line}\n`);
	else if (process.env.HARNESS_LOG === "1") process.stderr.write(`${line}\n`);
}

export function createLogger(scope: string): Logger {
	return {
		debug: (msg, extra) => emit("debug", scope, msg, extra),
		info: (msg, extra) => emit("info", scope, msg, extra),
		warn: (msg, extra) => emit("warn", scope, msg, extra),
		error: (msg, extra) => emit("error", scope, msg, extra),
		child: (sub) => createLogger(`${scope}:${sub}`),
	};
}

export function silentLogger(): Logger {
	const noop = () => undefined;
	const logger: Logger = {
		debug: noop,
		info: noop,
		warn: noop,
		error: noop,
		child: () => logger,
	};
	return logger;
}
