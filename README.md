<p align="center">
	<img src="brand/logo/favicon-agent-bg-32.svg" alt="Caelence agent" width="96" height="96" />
</p>

# Caelence agent

A coding agent on this machine

Desktop app, or the terminal.

[`@useavalon/caelence-agent`](https://www.npmjs.com/package/@useavalon/caelence-agent) on npm. Needs [Bun](https://bun.sh) 1.2 or later.

## Install

```bash
bun add -g @useavalon/caelence-agent
caelence desktop
```

`caelence desktop` opens the OS window. Paste an OpenRouter key in **Settings** after it opens. You do not need to export `OPENROUTER_API_KEY` in the terminal. The window needs [Rust](https://rustup.rs).

<p align="center">
	<img src="brand/previews/desktop-chat.png" alt="Desktop chat" width="720" />
</p>

Or the terminal:

```bash
caelence
```

`caelence` opens the terminal UI. Paste an OpenRouter key with `/settings key <token>`. In a git repo, that repo is the workspace. `--cwd` picks a folder. `caelence-agent` and `harness` are the same CLI.

## Config

Optional. Without `harness.config.ts`, these defaults apply.

```ts
import type { HarnessConfig } from "@useavalon/caelence-agent";

export default {
	name: "my-agent",
	model: "openrouter/auto",
	instructionsFile: "AGENTS.md",
	skillsDir: "skills",
	evalsDir: "evals",
	theme: "caelence",
	mode: "agent",
	tools: { exec: { approval: "prompt" } },
	mcp: [],
} satisfies HarnessConfig;
```

| File | Role |
|------|------|
| `harness.config.ts` | Name, model, mode, skills, evals, theme, approvals |
| `skills/**/SKILL.md` | Skills the agent can load |
| `evals/<suite>/eval.ts` | Eval suites |
| `AGENTS.md` | Project instructions |
| `~/.harness/AGENTS.md` | User instructions for every project |
| `.harness/sessions/` | Session logs |
| `~/.harness/integrations.json` | Connected hosted MCP servers |

Desktop Settings stores a key in `~/.harness`. Optional env: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`. In the TUI, `/settings key <token>` does the same.

## Commands

```
caelence desktop              Desktop window (needs Rust)
caelence                      Terminal UI
caelence chat -m "…"          One turn, then exit (no TUI)
caelence --mode plan          Start the TUI in plan mode
caelence eval [name]          Run an eval suite, or list suites
caelence experiment           Local website-generation regression (no Langfuse)
caelence init                 Add .harness/ to .gitignore
caelence skill find [query]   Bundled skills and popular skills.sh
caelence skill add <src>      Install into ~/.harness/skills
caelence skill remove <name>  Uninstall a user skill, or disable a project skill
caelence help                 This list
```

Flags: `--mode ask|plan|agent`, `--cwd <path>`, `-m` / `--message <text>`. `caelence init --examples` writes a host scaffold (`--name` sets the config name).

`caelence chat -m "…"` runs one turn, prints the reply (and tool lines), then exits. For a script or CI: no desktop, no TUI. `--mode` still applies. Without a TTY, tool approval is deny.

Type `/` for slash commands. Tab completes in the terminal UI.

<p align="center">
	<img src="brand/previews/desktop-commands.png" alt="Desktop slash commands" width="720" />
</p>

```
/help              this list
/skills            loaded skills
/skill find [q]    browse bundled and skills.sh
/skill add         install a bundled or skills.sh skill
/skill new         author a project skill
/skill remove      remove a user skill
/integrations      connect MCP servers
/eval [name]       run an eval suite
/clear             new session
/resume            pick a session by title
/model             pick a model
/mode              ask, plan, or agent
/compact           summarize earlier turns
/image [prompt]    generate an image
/video [prompt]    generate a clip
/transcribe        speech to text model
/settings          OpenRouter API key
/exit              quit
```

`/skill add --project <name>` writes into the project `skillsDir`. `/skill new <name> <what it should do>` authors a project skill from a brief.

## Skills

A skill is a `SKILL.md` with YAML `name` and `description`. Skills in `~/.harness/skills` and in the project load; the project wins on name clash. Bundled skills and skills.sh are a catalog: add one and it starts working. The agent also reads `skills/`, `.cursor/skills`, and `.claude/skills` when those folders exist. Disable a project skill from `/skill find` to keep the file and drop it from the prompt.

<p align="center">
	<img src="brand/previews/desktop-skills.png" alt="Desktop skills" width="720" />
</p>

| Add | What you get |
|------|------|
| `copywriting` | One writing pipeline: RMBC, Harry Dry, then copy-editor. No invented metrics or testimonials. |
| `impeccable` | Visual QA against the host `design.md` (Apache 2.0 adaptation) |

## Integrations

Hosted MCP servers the agent can call. Connect from the desktop sidebar or `/integrations`. Sign-in is in the browser; those tools show up on the next turn.

<p align="center">
	<img src="brand/previews/desktop-integrations.png" alt="Desktop integrations" width="720" />
</p>

| Connect | Needs |
|------|------|
| Hosted server | Browser sign-in |
| Google or Microsoft | Desktop OAuth client in Settings |
| Figma | Dev Mode MCP in Figma desktop |

Connections are stored in `~/.harness/integrations.json`. Disconnect removes that row.

`mcp` in `harness.config.ts` adds local stdio servers (`command`, `args`, `env`) for this project.

## Modes

| Mode | Tools |
|------|------|
| `ask` | Read, search, git status / diff / log |
| `plan` | Ask plus `todo_write` |
| `agent` | Writes, `exec`, `git_commit`, and `task` |

`/mode ask`, `/mode plan`, or `/mode agent`. `exec` and `git_commit` ask for approval by default (`prompt`). `auto` still denies destructive commands. Local exec is the host machine, not a sandbox.

## Library

The desktop, TUI, and `caelence chat -m` all call `createHarness`. Call it from your own UI, bot, or script.

```bash
bun add @useavalon/caelence-agent
```

```ts
import { createHarness } from "@useavalon/caelence-agent";

const harness = await createHarness({ cwd: process.cwd() });
await harness.runTurn("fix the failing test", (event) => {
	if (event.kind === "text_delta") process.stdout.write(event.text);
	if (event.kind === "tool_call_start") process.stderr.write(`› ${event.toolName}\n`);
});
harness.close();
```

`runTurn` streams `AgentEvent`s (text, tools, usage, errors) and writes the session under `.harness/sessions`. Optional: `config`, `mode`, `provider`, `extraTools`, `approvalPolicy`, `observability`.

You can pass a custom model provider in tests. `extraTools` adds MCP tools of your own. `approvalAsk` on `runTurn` is how a host UI prompts for `exec` and `git_commit`.

Other exports from the same package:

| Import | Use |
|------|------|
| `HarnessConfig`, `loadConfig` | Typed `harness.config.ts` |
| `createOpenRouterChat` | OpenRouter chat without the full agent |
| `EvalSuite`, `runNamedEval` | Eval suites under `evals/` |
| `initHost` | Add `.harness/` to `.gitignore`. `examples: true` writes a host scaffold |
| `@useavalon/caelence-agent/observability` | Langfuse, gates, `runLocalExperiment` |

Config types and observability do not require `createHarness`.

## Contributing

Bugs and feature ideas go through GitHub issues. Code from outside the org comes in as a fork and a pull request against `main`. The maintainer reviews before merge. See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports use a [private advisory](https://github.com/useAvalon/caelence-agent/security/advisories/new), not a public issue.

## License

[MIT](LICENSE)
