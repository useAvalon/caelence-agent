export const HOOK_EVENTS = ["session_start", "pre_tool", "post_tool"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookConfig {
	event: HookEvent;
	command: string;
}

export interface HookRunner {
	sessionStart(): Promise<void>;
	preTool(
		toolName: string,
		input: Record<string, unknown>,
	): Promise<{ allow: boolean; reason?: string }>;
	postTool(toolName: string, input: Record<string, unknown>, success: boolean): Promise<void>;
}

const HOOK_TIMEOUT_MS = 8_000;

async function runHookCommand(input: {
	cwd: string;
	command: string;
	payload: unknown;
}): Promise<{ exit: number; stderr: string }> {
	const proc = Bun.spawn(["/bin/sh", "-lc", input.command], {
		cwd: input.cwd,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	proc.stdin.write(JSON.stringify(input.payload));
	proc.stdin.end();
	const timer = setTimeout(() => proc.kill(), HOOK_TIMEOUT_MS);
	try {
		const [stderr, exit] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
		return { exit, stderr: stderr.slice(0, 2_000) };
	} finally {
		clearTimeout(timer);
	}
}

export function createHookRunner(input: { cwd: string; hooks?: HookConfig[] }): HookRunner {
	const hooks = input.hooks ?? [];
	const matching = (event: HookEvent) => hooks.filter((hook) => hook.event === event);

	return {
		async sessionStart() {
			for (const hook of matching("session_start")) {
				try {
					await runHookCommand({
						cwd: input.cwd,
						command: hook.command,
						payload: { event: "session_start" },
					});
				} catch {
					// fail-soft
				}
			}
		},
		async preTool(toolName, payload) {
			for (const hook of matching("pre_tool")) {
				try {
					const result = await runHookCommand({
						cwd: input.cwd,
						command: hook.command,
						payload: { event: "pre_tool", toolName, input: payload },
					});
					if (result.exit !== 0) {
						return {
							allow: false,
							reason: result.stderr.trim() || `pre_tool hook exited ${result.exit}`,
						};
					}
				} catch {
					// spawn failure fails open so a broken hook cannot freeze the TUI
				}
			}
			return { allow: true };
		},
		async postTool(toolName, payload, success) {
			for (const hook of matching("post_tool")) {
				try {
					await runHookCommand({
						cwd: input.cwd,
						command: hook.command,
						payload: { event: "post_tool", toolName, input: payload, success },
					});
				} catch {
					// fail-soft
				}
			}
		},
	};
}
