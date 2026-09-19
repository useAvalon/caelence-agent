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

export function isFileWriteTool(toolName: string): boolean {
	return toolName === "edit_file" || toolName === "write_file";
}

export function isUploadEditRequest(req: ApprovalRequest): boolean {
	return (
		isFileWriteTool(req.toolName) &&
		typeof req.input.originalPath === "string" &&
		req.input.originalPath.trim().length > 0
	);
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
	resolveUploadEdit?: (
		path: string,
	) => { rel: string; sourcePath: string; name: string } | undefined;
}

async function promptAsk(deps: ExecApprovalGateDeps, req: ApprovalRequest): Promise<boolean> {
	deps.emit?.({
		kind: "approval_request",
		callId: req.callId,
		toolName: req.toolName,
		input: req.input,
	});
	if (!deps.ask) return false;
	return deps.ask(req);
}

export function createExecApprovalGate(deps: ExecApprovalGateDeps): ApprovalGate {
	const always = deps.alwaysAllow ?? new Set<string>();
	return {
		async request(req) {
			if (isFileWriteTool(req.toolName) && deps.resolveUploadEdit) {
				const path = typeof req.input.path === "string" ? req.input.path : "";
				const hit = deps.resolveUploadEdit(path);
				if (hit) {
					req.input.copyPath = hit.rel;
					req.input.originalPath = hit.sourcePath;
					req.input.fileName = hit.name;
					return promptAsk(deps, req);
				}
			}
			if (isFileWriteTool(req.toolName)) {
				if (always.has("write_file") || always.has("edit_file") || always.has(req.toolName)) {
					return true;
				}
				if (deps.policy === "prompt" && deps.ask) return promptAsk(deps, req);
				return true;
			}
			if (!isRiskyToolCall(req.toolName)) return true;
			if (always.has(req.toolName)) return true;
			if (deps.policy === "deny") return false;
			const command = commandOf(req);
			if (deps.policy === "auto") {
				return !isLikelyDestructive(command);
			}
			return promptAsk(deps, req);
		},
	};
}

export function allowAlways(set: Set<string>, toolName: string): void {
	set.add(toolName);
}
