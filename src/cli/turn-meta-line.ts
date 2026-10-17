import type { AgentEvent } from "../core/events.ts";
import { JEV_MODEL } from "../decisions/jev.ts";
import { HARNESS_MODELS } from "./models.ts";
import { cachedLiveTargetNames } from "./openrouter-live.ts";

export function formatTurnMetaLine(event: Extract<AgentEvent, { kind: "turn_meta" }>): string {
	if (event.routing === "jev_shortcut") {
		const jev = event.jevModel ?? JEV_MODEL;
		const tool = event.toolName ?? "action";
		return `Turn: Jev (${jev}) → ${tool} · no chat model`;
	}
	const id = event.modelId ?? "unknown";
	const label = HARNESS_MODELS.find((model) => model.id === id)?.label ?? id;
	const resolved = event.resolvedModelId ?? cachedLiveTargetNames().get(id);
	if (resolved && resolved !== id && resolved.toLowerCase() !== label.toLowerCase()) {
		return `Turn: chat · ${label} → ${resolved}`;
	}
	return `Turn: chat · ${label}`;
}
