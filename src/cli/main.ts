import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, resolveOpenRouter } from "../config.ts";
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
import { PRODUCT_NAME } from "../product.ts";
import { createHarness } from "../runtime.ts";
import { loadSkills } from "../skills/loader.ts";
import { installSkillFromSource, removeSkillFromRoots, searchSkills } from "../skills/registry.ts";
import { parseSkillCommand } from "../skills/skill-command.ts";
import { userSkillsDir } from "../skills/user-dir.ts";
import { startTui } from "./tui.tsx";

function printHelp(): void {
	process.stdout.write(`${PRODUCT_NAME}

Usage:
  harness                 Fullscreen terminal UI
  harness desktop         Open the desktop window
  harness chat -m <text>  One-shot turn
  harness eval [name]     Run an eval suite (list if omitted)
  harness experiment      Run the local regression dataset (no Langfuse required)
  harness init            Write host project files
  harness skill find [q]  Search bundled skills and skills.sh
  harness skill add <src> Install a bundled or skills.sh skill into ~/.harness/skills
  harness help            This message

Flags:
  --mode ask|plan|agent   Read-only, plan, or implement (default agent)
  --cwd <path>            Project root
  -m, --message <text>    Chat message
  --name <name>           Init project name

Modes:
  ask    Read the repo. No edits, exec, commit, or task
  plan   Read plus todo_write. No edits
  agent  Full tools, including approved exec and git_commit

Instructions: ~/.harness/AGENTS.md (or HARNESS_USER_INSTRUCTIONS) then project AGENTS.md
Git tools: git_status, git_diff, git_log, git_commit (approval, no push)
Hooks: session_start, pre_tool (nonzero exit denies), post_tool in harness.config.ts

Install in another project:
  bun add github:useAvalon/caelence-agent
  bunx harness init
  bunx harness

Env: OPENROUTER_API_KEY, optional OPENROUTER_MODEL, OPENROUTER_BASE_URL
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
		case "todos":
			process.stderr.write(
				`\ntodos ${event.items.map((item) => `${item.status} ${item.content}`).join(" · ")}\n`,
			);
			break;
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

export async function main(argv = process.argv.slice(2)): Promise<number> {
	const parsed = parseCliArgs(argv);
	const { cwd, cmd, rest } = parsed;

	if (cmd === "help" || cmd === "--help" || cmd === "-h") {
		printHelp();
		return 0;
	}

	if (cmd === "desktop") {
		const desktopDir = resolve(fileURLToPath(new URL("../../desktop", import.meta.url)));
		if (!existsSync(resolve(desktopDir, "package.json"))) {
			process.stderr.write("Desktop app files are missing from this install.\n");
			return 1;
		}
		const env = desktopToolchainEnv(desktopDir, cwd);
		if (!hasCargo(env)) {
			process.stderr.write(
				"Rust is required for the desktop window. Install rustup from https://rustup.rs then run harness desktop again.\n",
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

	if (cmd === "init") {
		const result = initHost({ cwd, name: parsed.name });
		for (const rel of result.created) process.stdout.write(`created ${rel}\n`);
		for (const rel of result.skipped) process.stdout.write(`skipped ${rel}\n`);
		return 0;
	}

	if (cmd === "skill") {
		const action = parseSkillCommand(rest.join(" "));
		if ("error" in action) {
			process.stderr.write(`${action.error}\n`);
			return 1;
		}
		if (action.action === "find") {
			process.stdout.write(`${await searchSkills(action.query)}\n`);
			return 0;
		}
		if (action.action === "add") {
			const config = action.scope === "project" ? await loadConfig(cwd) : undefined;
			const destRoot =
				action.scope === "project" ? resolve(cwd, config?.skillsDir ?? "skills") : userSkillsDir();
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
		if (action.action === "remove") {
			const result = removeSkillFromRoots(action.name, [userSkillsDir(), resolve(cwd, "skills")]);
			if (!result.removed) {
				process.stderr.write(`${result.reason ?? "Could not remove."}\n`);
				return 1;
			}
			process.stdout.write(`Removed ${action.name}\n`);
			return 0;
		}
		process.stderr.write("Use the TUI for /skill new.\n");
		return 1;
	}

	if (cmd === "eval") {
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
				process.stdout.write(
					`  ${step.id} ${step.ok ? "ok" : "fail"}${step.detail ? ` ${step.detail}` : ""}\n`,
				);
			}
			return result.ok ? 0 : 1;
		} finally {
			await obs.shutdown();
		}
	}

	if (cmd === "experiment") {
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
							const brief =
								input && typeof input === "object" && "brief" in input
									? String((input as { brief?: unknown }).brief ?? "")
									: "";
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

	const mode = resolveCliMode(parsed.mode);
	if (mode === "invalid") {
		process.stderr.write("Mode is ask, plan, or agent.\n");
		return 1;
	}

	applyStoredOpenRouterKey();

	if (cmd === "chat") {
		const message = parsed.message;
		if (!message) {
			process.stderr.write("harness chat -m <text>\n");
			return 1;
		}
		const tty = Boolean(process.stdin.isTTY);
		const harness = await createHarness({
			cwd,
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

	if (cmd?.startsWith("-")) {
		process.stderr.write(`Unknown flag ${cmd}. Try harness help.\n`);
		return 1;
	}

	if (cmd) {
		process.stderr.write(`Unknown command ${cmd}. Try harness help.\n`);
		return 1;
	}

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

if (import.meta.main) {
	main().then(
		(code) => process.exit(code),
		(err) => {
			process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
			process.exit(1);
		},
	);
}
