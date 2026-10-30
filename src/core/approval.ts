import type { AgentEventEmitter } from "./events.ts";

export type ExecApprovalPolicy = "prompt" | "deny" | "auto";

export interface ApprovalRequest {
	callId: string;
	toolName: string;
	input: Record<string, unknown>;
	/** Why the tool asked for approval, in words the user can act on. Set by `confirm`. */
	reason?: string;
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
	/**
	 * Runs only where the gate would otherwise ask the user. It can answer "allow" to skip the
	 * prompt and can never deny. Must not throw; a throw or "ask" falls through to the prompt.
	 */
	assist?: (req: ApprovalRequest) => Promise<"allow" | "ask">;
	/**
	 * When set, only requests this returns true for go through the normal approval path. Every
	 * other request runs without a prompt. Use it for a host that wants fewer prompts, such as
	 * asking only before deletions. The `deny` policy and the host denylist still apply to the
	 * requests it lets through.
	 */
	promptOnly?: (req: ApprovalRequest) => boolean;
}

async function promptAsk(deps: ExecApprovalGateDeps, req: ApprovalRequest): Promise<boolean> {
	deps.emit?.({
		kind: "approval_request",
		callId: req.callId,
		toolName: req.toolName,
		input: req.input,
		...(req.reason ? { reason: req.reason } : {}),
	});
	if (!deps.ask) return false;
	return deps.ask(req);
}

async function assistedAsk(deps: ExecApprovalGateDeps, req: ApprovalRequest): Promise<boolean> {
	if (deps.assist) {
		try {
			if ((await deps.assist(req)) === "allow") return true;
		} catch {
			// fall through to the prompt
		}
	}
	return promptAsk(deps, req);
}

export function createExecApprovalGate(deps: ExecApprovalGateDeps): ApprovalGate {
	const always = deps.alwaysAllow ?? new Set<string>();
	return {
		async request(req) {
			// A tool asked for a human on this call. Nothing else may answer for the user: not
			// promptOnly, "always allow", the auto policy, or the decision-model assist.
			if (req.reason) {
				if (deps.policy === "deny") return false;
				return promptAsk(deps, req);
			}
			if (deps.promptOnly && !deps.promptOnly(req)) return true;
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
				if (deps.policy === "prompt" && deps.ask) return assistedAsk(deps, req);
				return true;
			}
			if (!isRiskyToolCall(req.toolName)) return true;
			if (always.has(req.toolName)) return true;
			if (deps.policy === "deny") return false;
			const command = commandOf(req);
			if (deps.policy === "auto") {
				return !isLikelyDestructive(command);
			}
			return assistedAsk(deps, req);
		},
	};
}

export function allowAlways(set: Set<string>, toolName: string): void {
	set.add(toolName);
}
