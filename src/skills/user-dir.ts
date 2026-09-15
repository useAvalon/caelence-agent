import { homedir } from "node:os";
import { resolve } from "node:path";

export function userSkillsDir(env: Record<string, string | undefined> = process.env): string {
	const override = env.HARNESS_USER_SKILLS?.trim();
	if (override) return resolve(override);
	return resolve(homedir(), ".harness", "skills");
}
