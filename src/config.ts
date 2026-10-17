import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Theme, ThemeName } from "./cli/theme.ts";
import type { ExecApprovalPolicy } from "./core/approval.ts";
import type { HookConfig } from "./core/hooks.ts";
import type { AgentMode } from "./core/mode.ts";

export interface ExtraMcpServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface HarnessConfig {
	name: string;
	model: string;
	instructionsFile: string;
	skillsDir: string;
	evalsDir: string;
	theme: ThemeName | Theme;
	tools: { exec: { approval: ExecApprovalPolicy } };
	mcp: ExtraMcpServerConfig[];
	openrouterBaseUrl?: string;
	subagents?: { enabled?: boolean };
	observability?: { enabled?: boolean };
	/** Cross-session memory. Off unless this is true or ~/.harness/memory.json enables it. */
	memory?: { enabled?: boolean };
	/** Default agent. ask = read only. plan = read + todos. */
	mode?: AgentMode;
	hooks?: HookConfig[];
}

export const DEFAULT_MODEL = "openrouter/auto";
export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export const DEFAULT_CONFIG: HarnessConfig = {
	name: "caelence",
	model: DEFAULT_MODEL,
	instructionsFile: "AGENTS.md",
	skillsDir: "skills",
	evalsDir: "evals",
	theme: "caelence",
	tools: { exec: { approval: "prompt" } },
	mcp: [],
};

export function resolveConfigPath(cwd: string): string | undefined {
	for (const name of ["harness.config.ts", "harness.config.js", "harness.config.mjs"]) {
		const path = resolve(cwd, name);
		if (existsSync(path)) return path;
	}
	return undefined;
}

export async function loadConfig(cwd: string): Promise<HarnessConfig> {
	const path = resolveConfigPath(cwd);
	if (!path) return { ...DEFAULT_CONFIG };
	const mod = (await import(pathToFileURL(path).href)) as { default?: Partial<HarnessConfig> };
	const partial = mod.default ?? {};
	return {
		...DEFAULT_CONFIG,
		...partial,
		tools: {
			exec: {
				approval: partial.tools?.exec?.approval ?? DEFAULT_CONFIG.tools.exec.approval,
			},
		},
		mcp: partial.mcp ?? [],
		observability: partial.observability,
		memory: partial.memory,
		mode: partial.mode,
		hooks: partial.hooks,
	};
}

export function stripTrailingSlashes(value: string): string {
	let trimmed = value;
	while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
	return trimmed;
}

export function resolveOpenRouter(config: HarnessConfig): {
	apiKey: string;
	baseUrl: string;
	model: string;
} {
	const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
	const baseUrl =
		process.env.OPENROUTER_BASE_URL?.trim() ||
		config.openrouterBaseUrl ||
		OPENROUTER_DEFAULT_BASE_URL;
	const model = process.env.OPENROUTER_MODEL?.trim() || config.model;
	return { apiKey, baseUrl: stripTrailingSlashes(baseUrl), model };
}
