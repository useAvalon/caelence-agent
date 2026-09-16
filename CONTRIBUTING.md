# Contributing

External work comes in as a **fork and a pull request**. `main` is protected: it needs a pull request, passing CI, and a review from the maintainer. We do not grant write access so you can push a branch on this repo.

## Setup

You need [Bun](https://bun.sh) 1.2 or later. The desktop window also needs [Rust](https://rustup.rs).

```bash
git clone https://github.com/<you>/caelence-agent.git
cd caelence-agent
bun install
bun run typecheck
bun test
bunx biome ci .
```

`bun run desktop` starts the window. `bun start` starts the terminal UI. Paste or export an OpenRouter key the same way the README describes. Do not commit `.env`, `.harness/`, or API keys.

Coding agents should read [AGENTS.md](AGENTS.md) for layout, commands, and product rules.

## Pull requests

1. Fork [useAvalon/caelence-agent](https://github.com/useAvalon/caelence-agent).
2. Branch from `main` in your fork.
3. Keep the change to one problem. Match the style of the files you touch.
4. Open a pull request against `main` on this repo.
5. Fill in the PR template. CI (lint, typecheck, tests) has to pass.

The maintainer merges. Squash merge is the only merge method.

Issues are the place for bugs and feature ideas. Use the templates. Security reports go to [private advisories](https://github.com/useAvalon/caelence-agent/security/advisories/new), not the issue tracker.

## Scope

Skills, copy, and desktop or terminal behavior should follow what is already in the repo. Do not add a sample that invents customers, metrics, or testimonials. Do not add tooling that phones home.
