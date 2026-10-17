import type { AgentEventEmitter } from "../core/events.ts";
import { newId } from "../core/ids.ts";
import type { McpToolDefinition } from "../core/mcp.ts";
import { toolResultText } from "../core/mcp.ts";
import type { RunTurnDeps, TurnRequest } from "../core/run-turn.ts";
import type { Session } from "../core/session.ts";
import type { ResolvedHarnessDecisions } from "./config.ts";
import { planScreenShortcut } from "./screen-shortcut.ts";

/** A finished shortcut turn, or a URL Jev opened so the chat model can continue. */
export type JevShortcutOutcome = Session | string;

export async function tryJevShortcutTurn(
	deps: RunTurnDeps,
	req: TurnRequest,
	session: Session,
	emit: AgentEventEmitter,
	jev: ResolvedHarnessDecisions,
	toolDefs: McpToolDefinition[],
): Promise<JevShortcutOutcome | undefined> {
	if (!jev.shortcuts || req.editUserTurn !== undefined) return undefined;
	const plan = await planScreenShortcut({
		message: req.message,
		toolNames: new Set(toolDefs.map((row) => row.name)),
		apiKey: jev.apiKey,
		baseUrl: jev.baseUrl,
		model: jev.model,
		minConfidence: jev.minConfidence,
		berry: req.berryConversational !== undefined || process.env.HARNESS_BERRY === "1",
	});
	if (!plan) return undefined;
	const def = toolDefs.find((row) => row.name === plan.toolName);
	if (!def) return undefined;

	const callId = newId("jev");
	emit({
		kind: "turn_meta",
		routing: "jev_shortcut",
		jevModel: jev.model,
		toolName: plan.toolName,
	});
	emit({ kind: "tool_call_start", toolName: plan.toolName, callId, input: plan.input });
	let success = true;
	let errorText: string | undefined;
	try {
		const result = await def.handler(plan.input);
		if (result.isError) {
			success = false;
			errorText = toolResultText(result);
		}
	} catch (err) {
		success = false;
		errorText = err instanceof Error ? err.message : String(err);
	}
	emit({
		kind: "tool_call_end",
		toolName: plan.toolName,
		callId,
		success,
		...(errorText ? { error: errorText } : {}),
	});

	if (plan.continueWithAgent) {
		if (!success) return undefined;
		return plan.input.url;
	}

	const reply = success ? plan.reply : (errorText ?? "That action failed.");
	let next = await deps.store.append(session, {
		kind: "tool",
		name: plan.toolName,
		callId,
		status: success ? "ok" : "fail",
		preview: JSON.stringify(plan.input),
		...(errorText ? { error: errorText } : {}),
	});
	emit({ kind: "text_delta", text: reply });
	next = await deps.store.append(next, {
		kind: "turn",
		role: "assistant",
		content: reply,
	});
	emit({ kind: "completion" });
	return next;
}
