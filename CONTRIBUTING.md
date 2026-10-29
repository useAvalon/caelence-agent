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
5. If the change touches shipped files (`src/`, `bin/`, `skills/`, `desktop/`), run `bunx changeset` and commit the file it creates. See [Releases](#releases).
6. Fill in the PR template. CI (lint, typecheck, tests, changeset) has to pass.

The maintainer merges. Squash merge is the only merge method.

## Releases

Do not edit `version` in `package.json` and do not publish from a laptop.

1. A pull request that changes what ships on npm includes a changeset: `bunx changeset`, pick `patch`, `minor`, or `major`, and write one line a user would understand. CI fails without one. Add the `no changeset` label when npm should not change.
2. Merging to `main` opens or updates a **release: version packages** pull request with the version bump and changelog.
3. The maintainer merges that pull request. The Release workflow then publishes to npm, tags the version, and creates the GitHub Release.

There are no canary releases. Add the `pr preview` label to a pull request for an installable preview from pkg.pr.new.

Issues are the place for bugs and feature ideas. Use the templates. Security reports go to [private advisories](https://github.com/useAvalon/caelence-agent/security/advisories/new), not the issue tracker.

## Scope

Skills, copy, and desktop or terminal behavior should follow what is already in the repo. Do not add a sample that invents customers, metrics, or testimonials. Do not add tooling that phones home.
