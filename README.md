# @useavalon/caelence-agent

Caelence agent: a Strands turn loop, local filesystem tools, Cursor-style skills, eval suites, and a themable terminal UI. Hosts add their own skills, sandboxes, and product rules. This package does not import them.

## Install

```bash
bun add github:useAvalon/caelence-agent
# or, once published to npm
bun add @useavalon/caelence-agent
```

Global CLI:

```bash
bun add -g github:useAvalon/caelence-agent
harness
```

## Host project

```bash
bunx harness init
```

Writes `harness.config.ts`, `AGENTS.md`, a sample skill, and a smoke eval. Then:

```bash
export OPENROUTER_API_KEY=…
harness
```

| File | Role |
|------|------|
| `harness.config.ts` | Name, model, mode, skill/eval dirs, theme, exec approval, hooks |
| `skills/**/SKILL.md` | Cursor-style skills (YAML `name` / `description`) |
| `evals/<suite>/eval.ts` | Eval suites (`export default { name, steps }`) |
| `AGENTS.md` | Project instructions (stacked under user instructions) |
| `~/.harness/AGENTS.md` | User instructions for every host (`HARNESS_USER_INSTRUCTIONS` overrides the path) |
| `.harness/sessions/` | JSON session logs (gitignored) |

```ts
import type { HarnessConfig } from "@useavalon/caelence-agent";

export default {
  name: "my-agent",
  model: "~x-ai/grok-latest",
  instructionsFile: "AGENTS.md",
  skillsDir: "skills",
  evalsDir: "evals",
  theme: "caelence",
  mode: "agent",
  tools: { exec: { approval: "prompt" } },
  mcp: [],
  // hooks: [{ event: "pre_tool", command: "jq -e .toolName" }],
} satisfies HarnessConfig;
```

Env: `OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`.

Optional Langfuse tracing (server/CLI only — never set these in a browser):

```
LANGFUSE_SECRET_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_BASE_URL=
CAELENCE_AGENT_VERSION=   # optional; defaults to the package version
```

When both Langfuse keys are set, each chat turn, tool call, subagent, and eval run is traced. With keys unset the observer is a no-op. Set `observability: { enabled: false }` in `harness.config.ts` to force it off.

Set `LANGFUSE_QUALITY_EVAL=1` to run the optional LLM-as-judge after a turn (OpenRouter spend). Leave it unset otherwise.

```
harness experiment      Run the local website-generation-regression dataset
```

Documented quality gates live in `DEFAULT_GATES` (`build_success >= 0.98`, and later instruction/visual thresholds). They are config, not CI fail rules, until baselines exist. Full Agent_Layer + Daytona runs stay opt-in / nightly.

## Commands

```
harness                 Fullscreen terminal UI
harness --mode plan     Start in plan mode
harness chat -m "…"     One-shot turn (non-TTY denies exec)
harness eval [name]     Run or list eval suites
harness experiment      Run the local regression dataset
harness init            Scaffold host files
harness desktop         Open the Tauri app window
```

Type `/` in the terminal for a command list (tab completes, arrows move). `--help` as a chat line is treated as `/help` so it does not go to the model.

`/resume` and `/model` open a list. Tab or arrows move, enter chooses. Sessions show their title, not the file id. `/resume billing` also matches a title; `/resume 2` is the second row.

`/skills` prints names only.

Install from [skills.sh](https://skills.sh) into the harness user store (`~/.harness/skills`, or `HARNESS_USER_SKILLS`). That does not write into the repo:

```
/skill find
/skill add copywriting
/skill add impeccable
/skill add anthropics/skills@frontend-design
/skill remove copywriting
```

`/skill add --project <name>` writes into the host `skillsDir` instead. `/skill new <name> <what it should do>` still authors a project skill from a brief.

Skills are portable Agent Skill files (`SKILL.md` + YAML `name` / `description`). Load order: user (`~/.harness/skills`), then host (host wins). The package catalog is not loaded until you add a skill. The harness also reads `skills/`, `.cursor/skills`, and `.claude/skills` when those folders exist.

`harness` (no args) is a fullscreen terminal UI: alternate screen, sticky composer, session rail when the terminal is wide. Same idea as Claude Code. It is not a browser tab.

`/settings` shows whether an OpenRouter key is stored. `/settings key <token>` writes it to `~/.harness`. `/resume` picks a session by title.

`harness desktop` is the optional OS window. Same runtime. Rust (`rustup`) and bun are required.

```
harness
harness desktop
```

## Modes

| Mode | Tools |
|------|--------|
| `ask` | `read_file`, `glob`, `grep`, `read_skill`, `git_status`, `git_diff`, `git_log` |
| `plan` | ask plus `todo_write` |
| `agent` | all tools, including writes, `exec`, `git_commit`, and `task` |

Switch in the TUI with `/mode ask`, `/mode plan`, or `/mode agent`. The header shows the current mode. Token counts (and USD only when the provider reports a cost) appear there after a turn.

## Git

Prefer `git_status`, `git_diff`, and `git_log` over `exec`. `git_commit` needs approval, commits listed paths or already-staged files, and does not push. Paths stay under the project root.

`exec` and `git_commit` are gated. Default policy is `prompt` (y / n / always this session). `auto` still denies destructive commands. Local exec is the host, not a sandbox.

## Hooks

Optional `hooks` in `harness.config.ts`. Each hook is a shell command. JSON on stdin. `pre_tool` with a nonzero exit denies the call (stderr is the reason). Spawn failure fails open.

```
session_start   After the runtime starts
pre_tool        Before a tool runs. Nonzero exit denies
post_tool       After a tool finishes
```

User and project instruction files stack. Project `AGENTS.md` does not replace `~/.harness/AGENTS.md`.

## Subagents

The parent agent has a `task` tool. It runs a nested turn with the same local tools except `task` (no recursive spawn). Optional `skills` injects those skill bodies into the subagent. Nested sessions stay in memory and do not appear in `/resume`.

Use it for one copy-pipeline step, isolated research, or a bounded edit. Not for a one-line question.

## Optional catalog skills

The package ships a generic writing pipeline and a visual-QA skill. They are not loaded until you add them:

- `/skill add copywriting` — router plus `copy-rmbc`, `copy-harry-dry`, `copy-editor`
- `/skill add copy-editor` — that step only, including `references/anti-slop.md`
- `/skill add impeccable` — visual QA (critique / polish / audit). Honor the host `design.md`. Not copy.

`/skill remove copywriting` drops the writing pack. Host `skills/` of the same name still win. Read loaded skills with `read_skill`. Invented metrics and testimonials stay illegal.

A host can add its own skills in `skills/`, `.cursor/skills`, or `.claude/skills`. Those are not shipped here.

## Library

```ts
import { createHarness, loadSkills, runEvalSuite } from "@useavalon/caelence-agent";
```

Agent events use these kinds: `text_delta`, `tool_call_*`, `approval_request`, `session_meta`, `usage`, `todos`, `error`, `completion`.

## Publish

The package ships TypeScript source for Bun. CI on `main` and pull requests runs Biome, `tsc --noEmit`, and `bun run test`.

Set an `NPM_TOKEN` repository secret with publish rights to `@useavalon/caelence-agent`. Until that secret exists, canary is a no-op and Release only allows dry runs.

| Workflow | When |
|------|--------|
| `CI` | Push or PR to `main` |
| `Canary Release` | Push to `main` that touches `src/`, `bin/`, or `skills/` |
| `Release` | Manual. Channel: stable, beta, or rc. Default is dry-run |

```bash
bun run lint
bun run typecheck
bun run test
bun run check:exports
```
