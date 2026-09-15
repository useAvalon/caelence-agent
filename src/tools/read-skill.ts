import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorResult, type McpToolDefinition, textResult } from "../core/mcp.ts";
import type { Skill } from "../skills/loader.ts";
import { PathEscapeError, resolveUnderCwd } from "./paths.ts";

export function createReadSkillTool(skills: Skill[]): McpToolDefinition {
	const byName = new Map(skills.map((s) => [s.name.toLowerCase(), s]));
	return {
		name: "read_skill",
		description:
			"Read a loaded skill by name (user or project). Optional `file` reads a reference next to that skill (e.g. references/anti-slop.md). Prefer this over guessing skill contents.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Skill name from the catalog (e.g. copywriting)." },
				file: {
					type: "string",
					description: "Optional path relative to that skill's folder.",
				},
			},
			required: ["name"],
		},
		async handler(raw) {
			const name = typeof raw.name === "string" ? raw.name.trim() : "";
			if (!name) return errorResult("name is empty");
			const skill = byName.get(name.toLowerCase());
			if (!skill) {
				const known = [...byName.keys()].sort().join(", ") || "(none)";
				return errorResult(`Unknown skill ${JSON.stringify(name)}. Loaded: ${known}`);
			}
			const file = typeof raw.file === "string" ? raw.file.trim() : "";
			if (!file) return textResult(`# ${skill.name}\n\n${skill.body}`);
			try {
				const abs = resolveUnderCwd(dirname(skill.path), file);
				return textResult(readFileSync(abs, "utf8"));
			} catch (err) {
				if (err instanceof PathEscapeError) return errorResult(err.message);
				return errorResult(err instanceof Error ? err.message : String(err));
			}
		},
	};
}
