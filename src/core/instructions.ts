import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface InstructionLayers {
	user: string;
	project: string;
}

function readIfPresent(path: string): string {
	if (!existsSync(path)) return "";
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return "";
	}
}

export function userInstructionsPath(
	env: Record<string, string | undefined> = process.env,
): string {
	const override = env.HARNESS_USER_INSTRUCTIONS?.trim();
	if (override) return resolve(override);
	return resolve(homedir(), ".harness", "AGENTS.md");
}

/** User file (~/.harness/AGENTS.md) then the project file. Project does not replace the user layer. */
export function loadInstructionLayers(input: {
	cwd: string;
	projectFile: string;
	env?: Record<string, string | undefined>;
}): InstructionLayers {
	return {
		user: readIfPresent(userInstructionsPath(input.env)),
		project: readIfPresent(resolve(input.cwd, input.projectFile)),
	};
}

export function formatInstructionLayers(layers: InstructionLayers): string {
	const parts: string[] = [];
	if (layers.user) parts.push("## User instructions", layers.user);
	if (layers.project) parts.push("## Project instructions", layers.project);
	return parts.join("\n\n");
}
