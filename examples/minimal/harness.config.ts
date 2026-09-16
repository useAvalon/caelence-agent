import type { HarnessConfig } from "../../src/config.ts";

export default {
	name: "minimal",
	model: "openrouter/auto",
	instructionsFile: "AGENTS.md",
	skillsDir: "skills",
	evalsDir: "evals",
	theme: "caelence",
	tools: { exec: { approval: "deny" } },
	mcp: [],
} satisfies HarnessConfig;
