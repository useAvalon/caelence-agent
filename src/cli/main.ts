import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAgentCwd } from "../agent-cwd.ts";
import { loadConfig, resolveOpenRouter } from "../config.ts";
import { errorMessage } from "../core/errors.ts";
import type { AgentEvent } from "../core/events.ts";
import { type AgentMode, tryParseAgentMode } from "../core/mode.ts";
import { formatUsage } from "../core/usage.ts";
import { applyStoredOpenRouterKey } from "../desktop/secrets.ts";
import { createOpenRouterChat, listEvalSuites, runNamedEval } from "../evals/runner.ts";
import { initHost } from "../init.ts";
import { startObservability } from "../observability/create.ts";
import { runLocalExperiment } from "../observability/experiments.ts";
import { harnessPromptRecords, syncPrompts } from "../observability/prompts.ts";
import { WEBSITE_GENERATION_REGRESSION } from "../observability/regression-items.ts";
import { CLI_NAME, PRODUCT_NAME } from "../product.ts";
import { createHarness } from "../runtime.ts";
import { browseSkillCatalog } from "../skills/catalog.ts";
import { disableSkills } from "../skills/disabled.ts";
import {
	isBundledCatalogDir,
	loadMergedSkills,
	loadSkills,
	resolveHostSkillDirs,
} from "../skills/loader.ts";
import {
	formatBundledHits,
	formatRegistryHits,
	installSkillFromSource,
	removeSkillFromRoots,
	searchSkills,
} from "../skills/registry.ts";
import { parseSkillCommand } from "../skills/skill-command.ts";
import { userSkillsDir } from "../skills/user-dir.ts";
import { startTui } from "./tui.tsx";

function printHelp(): void {
	process.stdout.write(`${PRODUCT_NAME}

Usage:
  ${CLI_NAME}                 Terminal UI
  ${CLI_NAME} desktop         Open the desktop window
  ${CLI_NAME} chat -m <text>  One-shot turn
  ${CLI_NAME} eval [name]     Run an eval suite (list if omitted)
  ${CLI_NAME} experiment      Run the local regression dataset (no Langfuse required)
  ${CLI_NAME} init            Add .harness/ to .gitignore
  ${CLI_NAME} skill find [q]  Browse bundled and popular skills.sh (query to search)
  ${CLI_NAME} skill add <src> Install a bundled or skills.sh skill into ~/.harness/skills
  ${CLI_NAME} help            This message

Flags:
  --mode ask|plan|agent   Read-only, plan, or implement (default agent)
  --cwd <path>            Workspace folder
  -m, --message <text>    Chat message
  --name <name>           Init project name (with --examples)
  --examples              Init: also write config, AGENTS.md, sample skill, eval

Modes:
  ask    Read the repo. No edits, exec, commit, or task
  plan   Read plus todo_write. No edits
  agent  Full tools, including approved exec and git_commit

Instructions: ~/.harness/AGENTS.md (or HARNESS_USER_INSTRUCTIONS) then project AGENTS.md
Git tools: git_status, git_diff, git_log, git_commit (approval, no push)
Hooks: session_start, pre_tool (nonzero exit denies), post_tool in harness.config.ts

Install in another project:
  bun add github:useAvalon/caelence-agent
  bunx ${CLI_NAME}

Desktop: paste an OpenRouter key in Settings. Optional env: OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_BASE_URL
Optional Langfuse: LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL
Optional LLM-as-judge: LANGFUSE_QUALITY_EVAL=1 (off unless set; spends OpenRouter)
`);
}

function printEvent(event: AgentEvent): void {
	switch (event.kind) {
		case "text_delta":
			process.stdout.write(event.text);
			break;
		case "tool_call_start":
			process.stderr.write(`\n› ${event.toolName}\n`);
			break;
		case "tool_call_end":
			process.stderr.write(event.success ? "  ok\n" : `  fail ${event.error ?? ""}\n`);
			break;
		case "todos": {
			const todos = event.items.map((item) => `${item.status} ${item.content}`).join(" · ");
			process.stderr.write(`\ntodos ${todos}\n`);
			break;
		}
		case "usage":
			process.stderr.write(
				`\n${formatUsage({
					promptTokens: event.promptTokens,
					completionTokens: event.completionTokens,
					totalTokens: event.totalTokens,
					...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
				})}\n`,
			);
			break;
		case "error":
			process.stderr.write(`\n${event.message}\n`);
			break;
		case "completion":
			process.stdout.write("\n");
			break;
		default:
			break;
	}
}

function desktopToolchainEnv(desktopDir: string, cwd: string): NodeJS.ProcessEnv {
	const cargoHome = resolve(desktopDir, ".toolchain/cargo");
	const rustupHome = resolve(desktopDir, ".toolchain/rustup");
	const cargoBin = resolve(cargoHome, "bin");
	const env: NodeJS.ProcessEnv = { ...process.env, HARNESS_CWD: cwd };
	if (existsSync(resolve(cargoBin, "cargo"))) {
		env.CARGO_HOME = cargoHome;
		env.RUSTUP_HOME = rustupHome;
		env.PATH = `${cargoBin}:${env.PATH ?? ""}`;
	}
	return env;
}

function hasCargo(env: NodeJS.ProcessEnv): boolean {
	if (env.CARGO_HOME && existsSync(resolve(env.CARGO_HOME, "bin/cargo"))) return true;
	return (env.PATH ?? "").split(":").some((dir) => dir && existsSync(resolve(dir, "cargo")));
}

function takeFlag(args: string[], name: string): { value?: string; rest: string[] } {
	const idx = args.indexOf(name);
	if (idx < 0) return { rest: args };
	const value = args[idx + 1];
	return {
		value,
		rest: [...args.slice(0, idx), ...args.slice(idx + 2)],
	};
}

export function parseCliArgs(argv: string[]): {
	cwd: string;
	cwdExplicit: boolean;
	cmd?: string;
	rest: string[];
	name?: string;
	message?: string;
	mode?: string;
} {
	let args = argv;
	const cwdFlag = takeFlag(args, "--cwd");
	args = cwdFlag.rest;
	const nameFlag = takeFlag(args, "--name");
	args = nameFlag.rest;
	const modeFlag = takeFlag(args, "--mode");
	args = modeFlag.rest;
	const shortMsg = takeFlag(args, "-m");
	args = shortMsg.rest;
	const longMsg = takeFlag(args, "--message");
	args = longMsg.rest;
	const cmd = args[0];
	return {
		cwd: resolve(cwdFlag.value ?? process.cwd()),
		cwdExplicit: cwdFlag.value !== undefined,
		cmd,
		rest: args.slice(1),
		name: nameFlag.value,
		message: shortMsg.value ?? longMsg.value,
		mode: modeFlag.value,
	};
}

function resolveCliMode(raw: string | undefined): AgentMode | undefined | "invalid" {
	if (raw === undefined) return undefined;
	return tryParseAgentMode(raw) ?? "invalid";
}

type ParsedCli = ReturnType<typeof parseCliArgs>;

function agentCwd(parsed: ParsedCli): string {
	return resolveAgentCwd({
		start: parsed.cwd,
		explicit: parsed.cwdExplicit ? parsed.cwd : undefined,
	});
}

async function runDesktop(cwd: string): Promise<number> {
	const desktopDir = resolve(fileURLToPath(new URL("../../desktop", import.meta.url)));
	if (!existsSync(resolve(desktopDir, "package.json"))) {
		process.stderr.write("Desktop app files are missing from this install.\n");
		return 1;
	}
	const env = desktopToolchainEnv(desktopDir, cwd);
	if (!hasCargo(env)) {
		process.stderr.write(
			"Rust is required for the desktop window. Install rustup from https://rustup.rs then run caelence desktop again.\n",
		);
		return 1;
	}
	const child = spawn("bun", [resolve(desktopDir, "scripts/run-tauri.ts")], {
		cwd: desktopDir,
		env,
		stdio: "inherit",
	});
	return await new Promise<number>((done) => {
		child.on("exit", (code) => done(code ?? 1));
		child.on("error", (err) => {
			process.stderr.write(`${err.message}\n`);
			done(1);
		});
	});
}

function runInit(parsed: ParsedCli): number {
	const examples = parsed.rest.includes("--examples");
	const result = initHost({ cwd: parsed.cwd, name: parsed.name, examples });
	for (const rel of result.created) process.stdout.write(`created ${rel}\n`);
	for (const rel of result.skipped) process.stdout.write(`skipped ${rel}\n`);
	return 0;
}

function formatSkillHits(hits: Awaited<ReturnType<typeof browseSkillCatalog>>): string {
	if (hits.length === 0) return "No matches.";
	const bundled = hits.filter((hit) => hit.source === "bundled");
	const remote = hits.filter((hit) => hit.source !== "bundled");
	return [formatBundledHits(bundled), remote.length > 0 ? formatRegistryHits(remote) : ""]
		.filter(Boolean)
		.join("\n");
}

async function runSkillFind(query: string): Promise<number> {
	const text = query ? await searchSkills(query) : formatSkillHits(await browseSkillCatalog());
	process.stdout.write(`${text}\n`);
	return 0;
}

async function runSkillAdd(
	cwd: string,
	action: Extract<ReturnType<typeof parseSkillCommand>, { action: "add" }>,
): Promise<number> {
	const config = action.scope === "project" ? await loadConfig(cwd) : undefined;
	const projectDir = resolve(cwd, config?.skillsDir ?? "skills");
	const destRoot =
		action.scope === "project" && !isBundledCatalogDir(projectDir) ? projectDir : userSkillsDir();
	const result = await installSkillFromSource({
		source: action.source,
		destRoot,
		...(action.skill ? { skill: action.skill } : {}),
	});
	if ("error" in result) {
		const extra = result.choices?.length ? ` Available: ${result.choices.join(", ")}` : "";
		process.stderr.write(`${result.error}${extra}\n`);
		return 1;
	}
	process.stdout.write(`Loaded ${destRoot}/${result.rel}\n`);
	return 0;
}

async function runSkill(cwd: string, rest: string[]): Promise<number> {
	const action = parseSkillCommand(rest.join(" "));
	if ("error" in action) {
		process.stderr.write(`${action.error}\n`);
		return 1;
	}
	if (action.action === "find") return runSkillFind(action.query);
	if (action.action === "add") return runSkillAdd(cwd, action);
	if (action.action === "remove") {
		const roots = [userSkillsDir()];
		const projectSkills = resolve(cwd, "skills");
		if (!isBundledCatalogDir(projectSkills)) roots.push(projectSkills);
		const result = removeSkillFromRoots(action.name, roots);
		if (result.removed) {
			process.stdout.write(`Removed ${action.name}\n`);
			return 0;
		}
		const loaded = loadMergedSkills(resolveHostSkillDirs(cwd, "skills"), userSkillsDir());
		if (loaded.some((skill) => skill.name.toLowerCase() === action.name.toLowerCase())) {
			disableSkills(cwd, action.name);
			process.stdout.write(`Disabled ${action.name}\n`);
			return 0;
		}
		process.stderr.write(`${result.reason ?? "Could not remove."}\n`);
		return 1;
	}
	process.stderr.write("Use the TUI for /skill new.\n");
	return 1;
}

async function runEval(cwd: string, rest: string[]): Promise<number> {
	const config = await loadConfig(cwd);
	const name = rest[0];
	const evalsDir = resolve(cwd, config.evalsDir);
	if (!name) {
		const names = await listEvalSuites(evalsDir);
		if (names.length === 0) {
			process.stderr.write("No eval suites (expected evals/<name>/eval.ts).\n");
			return 1;
		}
		process.stdout.write(`${names.join("\n")}\n`);
		return 0;
	}
	const or = resolveOpenRouter(config);
	const skills = loadSkills(resolve(cwd, config.skillsDir));
	const obs = await startObservability({ enabled: config.observability?.enabled });
	void syncPrompts({ prompts: harnessPromptRecords() });
	try {
		const result = await runNamedEval({
			config,
			cwd,
			name,
			skills,
			chat: createOpenRouterChat({ apiKey: or.apiKey, baseUrl: or.baseUrl }),
			observability: obs,
		});
		process.stdout.write(`${result.name} ${result.ok ? "ok" : "fail"}\n`);
		for (const step of result.steps) {
			const mark = step.ok ? "ok" : "fail";
			const detail = step.detail ? ` ${step.detail}` : "";
			process.stdout.write(`  ${step.id} ${mark}${detail}\n`);
		}
		return result.ok ? 0 : 1;
	} finally {
		await obs.shutdown();
	}
}

function experimentBrief(input: unknown): string {
	if (!input || typeof input !== "object" || !("brief" in input)) return "";
	const brief = (input as { brief?: unknown }).brief;
	return typeof brief === "string" ? brief : "";
}

async function runExperiment(cwd: string): Promise<number> {
	const config = await loadConfig(cwd);
	const obs = await startObservability({ enabled: config.observability?.enabled });
	void syncPrompts({ prompts: harnessPromptRecords() });
	try {
		const result = await runLocalExperiment({
			name: "website-generation-regression",
			observability: obs,
			items: WEBSITE_GENERATION_REGRESSION,
			task: async (item) => item.input,
			evaluators: [
				{
					name: "has_brief",
					run: ({ input }) => {
						const brief = experimentBrief(input);
						return { value: brief.trim().length > 0 ? 1 : 0 };
					},
				},
			],
		});
		process.stdout.write(
			`${result.name} ${result.ok ? "ok" : "fail"} items=${result.itemResults.length} has_brief=${result.aggregates.has_brief ?? 0}\n`,
		);
		return result.ok ? 0 : 1;
	} finally {
		await obs.shutdown();
	}
}

async function runChat(parsed: ParsedCli, mode: AgentMode | undefined): Promise<number> {
	const message = parsed.message;
	if (!message) {
		process.stderr.write("harness chat -m <text>\n");
		return 1;
	}
	const tty = Boolean(process.stdin.isTTY);
	const harness = await createHarness({
		cwd: agentCwd(parsed),
		approvalPolicy: tty ? undefined : "deny",
		...(mode ? { mode } : {}),
	});
	try {
		await harness.runTurn(message, printEvent, {
			approvalAsk: tty
				? async (req) => {
						process.stderr.write(`Approve ${req.toolName}? [y/N] `);
						return false;
					}
				: undefined,
		});
	} finally {
		harness.close();
		await harness.observability.shutdown();
	}
	return 0;
}

async function runTui(cwd: string, mode: AgentMode | undefined): Promise<number> {
	const harness = await createHarness({
		cwd,
		...(mode ? { mode } : {}),
	});
	try {
		await startTui(harness);
	} finally {
		harness.close();
		await harness.observability.shutdown();
	}
	return 0;
}

const COMMANDS: Record<string, (parsed: ParsedCli) => Promise<number>> = {
	help: async () => {
		printHelp();
		return 0;
	},
	"--help": async () => {
		printHelp();
		return 0;
	},
	"-h": async () => {
		printHelp();
		return 0;
	},
	desktop: async (parsed) => runDesktop(agentCwd(parsed)),
	init: async (parsed) => runInit(parsed),
	skill: async (parsed) => runSkill(parsed.cwd, parsed.rest),
	eval: async (parsed) => runEval(parsed.cwd, parsed.rest),
	experiment: async (parsed) => runExperiment(parsed.cwd),
	chat: async (parsed) => {
		const mode = resolveCliMode(parsed.mode);
		if (mode === "invalid") {
			process.stderr.write("Mode is ask, plan, or agent.\n");
			return 1;
		}
		applyStoredOpenRouterKey();
		return runChat(parsed, mode);
	},
};

export async function main(argv = process.argv.slice(2)): Promise<number> {
	const parsed = parseCliArgs(argv);
	const { cmd } = parsed;
	if (!cmd) {
		const mode = resolveCliMode(parsed.mode);
		if (mode === "invalid") {
			process.stderr.write("Mode is ask, plan, or agent.\n");
			return 1;
		}
		applyStoredOpenRouterKey();
		return runTui(agentCwd(parsed), mode);
	}
	const handler = COMMANDS[cmd];
	if (handler) return handler(parsed);
	if (cmd.startsWith("-")) {
		process.stderr.write(`Unknown flag ${cmd}. Try harness help.\n`);
		return 1;
	}
	process.stderr.write(`Unknown command ${cmd}. Try harness help.\n`);
	return 1;
}

if (import.meta.main) {
	try {
		process.exit(await main());
	} catch (err) {
		process.stderr.write(`${errorMessage(err)}\n`);
		process.exit(1);
	}
}
