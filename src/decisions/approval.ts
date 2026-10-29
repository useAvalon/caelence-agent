import type { ApprovalRequest } from "../core/approval.ts";
import { isLikelyDestructive } from "../core/approval.ts";
import { clipState, readNoulAnswer } from "./client.ts";
import { decide, type ResolvedDecisions } from "./config.ts";

/**
 * Decides whether a permission prompt can be skipped. It can only widen to "allow" when the
 * tool call clearly matches what the user asked. It never denies: a refusal still needs a human
 * or the host-side denylist. Any failure, low score, or destructive command means "ask".
 */
export type ApprovalVerdict = "allow" | "ask";

export async function classifyToolApproval(
	decisions: ResolvedDecisions,
	req: ApprovalRequest,
	userMessage: string | undefined,
	signal?: AbortSignal,
): Promise<ApprovalVerdict> {
	if (!decisions.approvals) return "ask";
	const command = typeof req.input.command === "string" ? req.input.command : "";
	if (command && isLikelyDestructive(command)) return "ask";
	if (!userMessage?.trim()) return "ask";

	const json = await decide(
		decisions,
		{
			user_message: clipState(userMessage, 1200),
			tool_name: req.toolName,
			tool_input: clipState(req.input),
		},
		{
			safe_to_run: {
				type: "noul",
				instructions:
					"Given the user's request, is this exact tool call something they asked for and safe to run without asking them first?",
				criteria: {
					true: "The call directly serves the request, only touches the project, and is easy to undo.",
					false:
						"The call is unrelated to the request, deletes or overwrites data, publishes or pushes anything, changes permissions, or reaches outside the project.",
				},
			},
		},
		signal,
	);
	const safe = readNoulAnswer(json, "safe_to_run");
	return safe !== null && safe >= decisions.approvalThreshold ? "allow" : "ask";
}
