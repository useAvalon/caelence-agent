import type { FailureCategory } from "./types.ts";

export interface FailureSignals {
	errorType?: string;
	phase?: string;
	typecheckPass?: boolean;
	testsPass?: boolean;
	uiPass?: boolean;
	timedOut?: boolean;
	toolFailed?: boolean;
	message?: string;
}

/** Map implement-cycle / error-log signals onto a Langfuse failure category. */
export function categorizeFailure(signals: FailureSignals): FailureCategory | undefined {
	if (signals.timedOut) return "TIMEOUT";
	const type = (signals.errorType ?? "").toLowerCase();
	const phase = (signals.phase ?? "").toLowerCase();
	const message = (signals.message ?? "").toLowerCase();

	if (type.includes("timeout") || message.includes("timed out")) return "TIMEOUT";
	if (signals.toolFailed || phase === "mcp" || type.includes("tool")) return "TOOL_ERROR";
	if (type.includes("mode_classify") || type.includes("planning") || phase === "planning") {
		return "PLANNING_ERROR";
	}
	if (signals.typecheckPass === false) return "BUILD_ERROR";
	if (signals.testsPass === false) return "BUILD_ERROR";
	if (signals.uiPass === false) return "RUNTIME_ERROR";
	if (type.includes("tdd") || type.includes("code_review") || type.includes("cycle_missing")) {
		return "CODE_GENERATION_ERROR";
	}
	if (type.includes("model") || (phase === "agent" && message.includes("provider")))
		return "MODEL_ERROR";
	if (type.includes("responsive") || message.includes("viewport")) return "RESPONSIVE_ERROR";
	if (type.includes("design")) return "DESIGN_ERROR";
	if (type.includes("requirement") || type.includes("instruction"))
		return "USER_REQUIREMENT_MISMATCH";
	if (phase === "sandbox") return "BUILD_ERROR";
	if (phase === "agent") return "CODE_GENERATION_ERROR";
	return undefined;
}
