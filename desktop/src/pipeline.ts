import { inputFromPreview } from "./tool-label";

export interface SkillToolRef {
	name: string;
	label: string;
	status: "running" | "ok" | "fail";
	preview: string;
}

export type PipeStepStatus = "done" | "run" | "wait";

export interface PipeStep {
	id: string;
	label: string;
	status: PipeStepStatus;
}

export interface PipelineProgress {
	family: string;
	title: string;
	steps: PipeStep[];
}

const COPY_STEPS = [
	{ id: "copywriting", label: "Copywriting" },
	{ id: "copy-rmbc", label: "RMBC" },
	{ id: "copy-harry-dry", label: "Harry Dry" },
	{ id: "copy-editor", label: "Copy editor" },
] as const;

const SKILL_LABELS: Record<string, string> = {
	copywriting: "Copywriting",
	"copy-rmbc": "RMBC",
	"copy-harry-dry": "Harry Dry",
	"copy-editor": "Copy editor",
	impeccable: "Impeccable",
};

export function prettySkillName(raw: string): string {
	const id = skillKey(raw);
	if (SKILL_LABELS[id]) return SKILL_LABELS[id];
	const spaced = id.replace(/[-_]+/g, " ").trim();
	return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : raw.trim();
}

export function skillKey(raw: string): string {
	const trimmed = raw.trim();
	const at = trimmed.lastIndexOf("@");
	const afterAt = at >= 0 ? trimmed.slice(at + 1) : trimmed;
	const slash = afterAt.lastIndexOf("/");
	return (slash >= 0 ? afterAt.slice(slash + 1) : afterAt).toLowerCase();
}

function isReadSkill(name: string): boolean {
	return name === "read_skill" || name.endsWith("__read_skill");
}

export function skillIdFromTool(tool: SkillToolRef): string | undefined {
	if (isReadSkill(tool.name)) {
		const parsed = inputFromPreview(tool.preview);
		if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
		const fromLabel = /^Reading(?: skill)?\s+(.+)$/i.exec(tool.label)?.[1];
		return fromLabel?.trim();
	}
	if (tool.name === "task") {
		const parsed = inputFromPreview(tool.preview);
		if (Array.isArray(parsed.skills)) {
			const first = parsed.skills.find((item): item is string => typeof item === "string");
			if (first?.trim()) return first.trim();
		}
		if (typeof parsed.label === "string" && parsed.label.trim()) return parsed.label.trim();
	}
	return undefined;
}

function isCopyFamily(id: string): boolean {
	const key = skillKey(id);
	return COPY_STEPS.some((step) => step.id === key);
}

function seenIds(
	tools: readonly SkillToolRef[],
): Array<{ id: string; running: boolean; ok: boolean }> {
	const out: Array<{ id: string; running: boolean; ok: boolean }> = [];
	for (const tool of tools) {
		const id = skillIdFromTool(tool);
		if (!id) continue;
		out.push({ id, running: tool.status === "running", ok: tool.status === "ok" });
	}
	return out;
}

export function pipelineProgress(tools: readonly SkillToolRef[]): PipelineProgress | undefined {
	const hits = seenIds(tools);
	if (hits.length === 0) return undefined;
	const copy = hits.some((hit) => isCopyFamily(hit.id));
	const defs = copy
		? COPY_STEPS.map((step) => ({ id: step.id, label: step.label }))
		: uniqueSkillDefs(hits.map((hit) => hit.id));
	const running = [...hits].reverse().find((hit) => hit.running);
	const latest = running ?? [...hits].reverse().find((hit) => hit.ok) ?? hits[0];
	if (!latest) return undefined;
	const currentKey = skillKey(latest.id);
	const steps: PipeStep[] = defs.map((def) => {
		const matched = hits.filter((hit) => skillKey(hit.id) === def.id);
		if (matched.some((hit) => hit.running) || def.id === currentKey) {
			return { ...def, status: latest.running || def.id === currentKey ? "run" : "done" };
		}
		if (matched.some((hit) => hit.ok)) return { ...def, status: "done" };
		return { ...def, status: "wait" };
	});
	const current =
		steps.find((step) => step.status === "run") ?? steps.find((step) => step.status === "done");
	const family = copy ? "Copywriting" : prettySkillName(latest.id);
	const title = latest.running
		? `Running ${prettySkillName(latest.id)}`
		: `Running ${current?.label ?? family}`;
	return { family, title, steps };
}

function uniqueSkillDefs(ids: string[]): Array<{ id: string; label: string }> {
	const seen = new Set<string>();
	const out: Array<{ id: string; label: string }> = [];
	for (const id of ids) {
		const key = skillKey(id);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ id: key, label: prettySkillName(id) });
	}
	return out;
}
