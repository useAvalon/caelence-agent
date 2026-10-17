import type { ApprovalRequest } from "../core/approval.ts";
import { isLikelyDestructive, isRiskyToolCall } from "../core/approval.ts";
import { readNoulAnswer, submitJevDecisions } from "./jev.ts";

export type JevApprovalVerdict = "allow" | "deny" | "ask";

export async function jevClassifyToolApproval(input: {
	req: ApprovalRequest;
	userMessage?: string;
	apiKey: string;
	baseUrl?: string;
	model?: string;
	minConfidence?: number;
	fetchImpl?: typeof fetch;
}): Promise<JevApprovalVerdict> {
	if (!input.apiKey.trim()) return "ask";
	const command = typeof input.req.input.command === "string" ? input.req.input.command : "";
	if (isRiskyToolCall(input.req.toolName) && isLikelyDestructive(command)) {
		return "deny";
	}

	const json = await submitJevDecisions({
		apiKey: input.apiKey,
		baseUrl: input.baseUrl,
		model: input.model,
		role: "utility",
		fetchImpl: input.fetchImpl,
		state: {
			user_message: input.userMessage?.trim() || "",
			tool_name: input.req.toolName,
			tool_input: input.req.input,
		},
		questions: {
			safe_to_run: {
				type: "noul",
				instructions:
					"Given the user's request and this tool call, is it reasonable to run without asking a human?",
				criteria: {
					true: "The tool matches what the user asked for, is reversible or low risk, and does not expose secrets or destroy data.",
					false:
						"The tool is unrelated, destructive, publishes packages, escalates privileges, or goes beyond the user's request.",
				},
			},
		},
	});
	const noul = readNoulAnswer(json, "safe_to_run");
	if (!noul) return "ask";
	const min = input.minConfidence ?? 0.65;
	if (noul.probability >= min) return "allow";
	if (noul.probability <= 1 - min) return "deny";
	return "ask";
}
