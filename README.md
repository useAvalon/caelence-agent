# Caelence agent

A coding agent you run in a project. Terminal UI, local tools, and skills you can add or remove.

[`@useavalon/caelence-agent`](https://www.npmjs.com/package/@useavalon/caelence-agent) on npm. Needs [Bun](https://bun.sh) 1.2 or later.

## Get started

```bash
bun add -g @useavalon/caelence-agent
cd your-project
bunx harness init
export OPENROUTER_API_KEY=…
harness
```

`bunx harness init` writes `harness.config.ts`, `AGENTS.md`, a sample skill, and a smoke eval. `harness` opens the terminal UI. `caelence-agent` is the same CLI.

As a library:

```bash
bun add @useavalon/caelence-agent
```

```ts
import { createHarness } from "@useavalon/caelence-agent";
```

## Config

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
} satisfies HarnessConfig;
```

| File | Role |
|------|------|
| `harness.config.ts` | Name, model, mode, skills, evals, theme, approvals |
| `skills/**/SKILL.md` | Skills the agent can load |
| `evals/<suite>/eval.ts` | Eval suites |
| `AGENTS.md` | Project instructions |
| `~/.harness/AGENTS.md` | User instructions for every project |
| `.harness/sessions/` | Session logs (gitignored) |

Set `OPENROUTER_API_KEY`. Optional: `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`. `/settings key <token>` stores a key in `~/.harness`.

## Commands

```
harness                 Terminal UI
harness --mode plan     Start in plan mode
harness chat -m "…"     One-shot turn
harness eval [name]     Run or list evals
harness init            Scaffold host files
harness desktop         Optional OS window (needs Rust)
```

Type `/` in the terminal for the command list. Tab completes.

```
/skill find
/skill add copywriting
/skill add impeccable
/skill add anthropics/skills@frontend-design
/skill remove copywriting
```

`/skill add --project <name>` writes into the project `skillsDir`. `/skill new <name> <what it should do>` authors a project skill from a brief.

## Skills

Skills are `SKILL.md` files with YAML `name` and `description`. Load order: user store (`~/.harness/skills`), then the project (project wins). The package catalog is off until you add a skill. The agent also reads `skills/`, `.cursor/skills`, and `.claude/skills` when those folders exist.

| Add | What you get |
|------|------|
| `copywriting` | Writing pipeline: RMBC, Harry Dry, copy-editor |
| `copy-editor` | That step only |
| `impeccable` | Visual QA against the host `design.md` |

Invented metrics and testimonials stay illegal.

## Modes

| Mode | Tools |
|------|------|
| `ask` | Read, search, git status / diff / log |
| `plan` | Ask plus `todo_write` |
| `agent` | Writes, `exec`, `git_commit`, and `task` |

`/mode ask`, `/mode plan`, or `/mode agent`. `exec` and `git_commit` ask for approval by default (`prompt`). `auto` still denies destructive commands. Local exec is the host machine, not a sandbox.

## License

[MIT](LICENSE)
