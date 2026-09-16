# Agents

This repository is Caelence agent: a local coding agent as a desktop window (Tauri + React), a terminal UI (Ink), and the `@useavalon/caelence-agent` package. Bun 1.2 or later is required. The desktop window also needs Rust.

When you run `caelence` in this checkout, this file is the project instructions.

## Commands

```bash
bun install
bun run typecheck
bun test
bunx biome ci .
bun start           # terminal UI
bun run desktop     # OS window
```

Do not commit `.env`, `.harness/`, OpenRouter keys, or OAuth client secrets. Desktop Settings stores the key under `~/.harness`. The terminal UI reads `export OPENROUTER_API_KEY`.

## Layout

| Path | What it is |
|------|------------|
| `src/` | Runtime, CLI, skills, integrations, desktop HTTP bridge |
| `desktop/` | Tauri webview. It talks to a loopback bridge; do not open that URL in a browser |
| `skills/` | Bundled catalog shipped with the package |
| `bin/harness.ts` | CLI (`caelence`, `caelence-agent`, and `harness` are the same bin) |

`createHarness` in `src/runtime.ts` is the shared turn loop. Tests sit next to the code they cover (`*.test.ts`). Biome is the formatter and linter; it runs on staged files at commit.

## Skills and copy

Bundled copywriting is one pipeline (`copywriting`), not four skills to add separately. `impeccable` is an Apache 2.0 adaptation; keep NOTICE and LICENSE.

Catalog identity is the skills.sh / GitHub id (`owner/repo@name` or `owner/repo/name`), not the YAML `name` alone. Install only from a real GitHub `owner/repo`. Host listings (for example `smithery.ai`) and names that are not in that repo should not be offered as Add targets.

Do not invent customers, metrics, testimonials, or other proof. Product UI should reuse existing Caelence copy. Action color in the TUI is the instrument blue `#6e93b8`, not green. Default model is Auto (`openrouter/auto`).

## Collaboration

Fork, branch from `main`, open a pull request. Do not push to `main`. Squash merge is the only method. CI is lint, typecheck, and tests. The maintainer (`@MadsHaerup`) reviews before merge. Human details are in [CONTRIBUTING.md](CONTRIBUTING.md).

Keep a change to one problem. Match the style of the files you touch. Desktop UI, layout, or client-state work needs an end-to-end check in the window, not only a screenshot.

Do not add telemetry that phones home. Langfuse is optional and off unless the host opts in. `caelence init` without `--examples` only appends `.harness/` to `.gitignore`.
