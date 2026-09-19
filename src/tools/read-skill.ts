import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	errorResult,
	type McpToolDefinition,
	READ_ONLY_ANNOTATIONS,
	textResult,
} from "../core/mcp.ts";
import type { Skill } from "../skills/loader.ts";
import { catalogRefsMatch, skillNameFromCatalogId } from "../skills/registry.ts";
import { PathEscapeError, resolveUnderCwd } from "./paths.ts";

function resolveSkill(skills: Skill[], name: string): Skill | { error: string } {
	const wanted = name.trim();
	if (!wanted) return { error: "name is empty" };
	const byRef = skills.filter(
		(skill) => skill.catalogRef && catalogRefsMatch(skill.catalogRef, wanted),
	);
	if (byRef.length === 1 && byRef[0]) return byRef[0];
	const yaml = skillNameFromCatalogId(wanted).toLowerCase() || wanted.toLowerCase();
	const byName = skills.filter((skill) => skill.name.toLowerCase() === yaml);
	if (byName.length === 1 && byName[0]) return byName[0];
	if (byName.length > 1) {
		const ids = byName.map((skill) => skill.catalogRef || skill.name).join(", ");
		return {
			error: `Several skills named ${JSON.stringify(wanted)}. Use one of: ${ids}`,
		};
	}
	const known =
		skills
			.map((skill) => skill.catalogRef || skill.name)
			.toSorted((left, right) => left.localeCompare(right))
			.join(", ") || "(none)";
	return { error: `Unknown skill ${JSON.stringify(name)}. Loaded: ${known}` };
}

export function createReadSkillTool(skills: Skill[]): McpToolDefinition {
	return {
		name: "read_skill",
		description:
			"Read a loaded skill by name or catalog id (user or project). Optional `file` reads a reference next to that skill (e.g. references/anti-slop.md). Prefer this over guessing skill contents.",
		annotations: READ_ONLY_ANNOTATIONS,
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description:
						"Skill name or catalog id from the prompt (e.g. copywriting or anthropics/skills/frontend-design).",
				},
				file: {
					type: "string",
					description: "Optional path relative to that skill's folder.",
				},
			},
			required: ["name"],
		},
		async handler(raw) {
			const name = typeof raw.name === "string" ? raw.name.trim() : "";
			const matched = resolveSkill(skills, name);
			if ("error" in matched) return errorResult(matched.error);
			const file = typeof raw.file === "string" ? raw.file.trim() : "";
			if (!file) return textResult(`# ${matched.name}\n\n${matched.body}`);
			try {
				const abs = resolveUnderCwd(dirname(matched.path), file);
				return textResult(readFileSync(abs, "utf8"));
			} catch (err) {
				if (err instanceof PathEscapeError) return errorResult(err.message);
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};
}
