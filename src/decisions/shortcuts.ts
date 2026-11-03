import type { ResolvedDecisions } from "./config.ts";

/**
 * A host can answer a message with one direct tool call and skip the chat model entirely
 * ("open example.com"). The harness owns the mechanism: it checks approval, runs the tool,
 * records the turn, and falls back to the agent on any failure. The host owns the judgment
 * of which messages qualify, usually with a Jev choice question via {@link decide}.
 *
 * Shortcuts only run when decisions are on (an OpenRouter key, not disabled), since the planner
 * receives the resolved decision settings. A host that does not use a decision model, or must
 * run even when decisions are off, should use `intercept` instead, which has no such gate.
 * `message` is what the user typed, without any host prefix.
 */
export interface ShortcutPlan {
	toolName: string;
	input: Record<string, unknown>;
	/** Final answer shown when the tool succeeds. */
	reply: string;
	/** Run the tool, then let the agent carry on instead of ending the turn. */
	continueWithAgent?: boolean;
	/** Added to the system prompt when continueWithAgent is set. */
	agentNote?: string;
}

export interface ShortcutContext {
	message: string;
	/** Tools available this turn, after mode filtering. */
	toolNames: ReadonlySet<string>;
	decisions: ResolvedDecisions;
	signal?: AbortSignal;
}

export type ShortcutPlanner = (ctx: ShortcutContext) => Promise<ShortcutPlan | undefined>;
