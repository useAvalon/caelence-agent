import type { AgentEventEmitter } from "./events.ts";

export type ExecApprovalPolicy = "prompt" | "deny" | "auto";

export interface ApprovalRequest {
	callId: string;
	toolName: string;
	input: Record<string, unknown>;
}

export interface ApprovalGate {
	request(req: ApprovalRequest): Promise<boolean>;
}

export function isRiskyToolCall(toolName: string): boolean {
	return toolName === "exec" || toolName === "git_commit";
}

/** Host-side denylist — local exec is the machine, not a sandbox. */
export const DESTRUCTIVE_COMMAND_PATTERNS: readonly RegExp[] = [
	/\bsudo\b/,
	/\bsu\s+-?\b/,
	/\bnpm\s+publish\b/,
	/\b(bun|pnpm|yarn)\s+publish\b/,
	/\bgit\s+push\b[^\n]*\s(--force\b|-f\b|--force-with-lease\b)/,
	/\bgit\s+push\b[^\n]*\s(--mirror\b|--delete\b|:\S)/,
	/\bcurl\b[^\n|]*\|\s*(sh|bash|zsh)\b/,
	/\bwget\b[^\n|]*\|\s*(sh|bash|zsh)\b/,
	/\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/,
	/\bmkfs\b|\bdd\s+if=/,
	/>\s*\/dev\/(sd|nvme|disk)/,
	/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
	/\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\b/,
];

export function isLikelyDestructive(command: string): boolean {
	return DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function parseExecApprovalPolicy(raw: string | undefined): ExecApprovalPolicy {
	const v = raw?.trim().toLowerCase();
	return v === "deny" || v === "auto" || v === "prompt" ? v : "prompt";
}

function commandOf(req: ApprovalRequest): string {
	return typeof req.input.command === "string" ? req.input.command : "";
}

export interface ExecApprovalGateDeps {
	policy: ExecApprovalPolicy;
	/** Called when policy is `prompt`. Must resolve true/false. */
	ask?: (req: ApprovalRequest) => Promise<boolean>;
	/** Optional event sink so the TUI can show the permission card. */
	emit?: AgentEventEmitter;
	alwaysAllow?: Set<string>;
}

export function createExecApprovalGate(deps: ExecApprovalGateDeps): ApprovalGate {
	const always = deps.alwaysAllow ?? new Set<string>();
	return {
		async request(req) {
			if (!isRiskyToolCall(req.toolName)) return true;
			if (always.has(req.toolName)) return true;
			if (deps.policy === "deny") return false;
			const command = commandOf(req);
			if (deps.policy === "auto") {
				return !isLikelyDestructive(command);
			}
			deps.emit?.({
				kind: "approval_request",
				callId: req.callId,
				toolName: req.toolName,
				input: req.input,
			});
			if (!deps.ask) return false;
			return deps.ask(req);
		},
	};
}

export function allowAlways(set: Set<string>, toolName: string): void {
	set.add(toolName);
}
