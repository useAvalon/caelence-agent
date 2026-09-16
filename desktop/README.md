# Caelence agent desktop

A Tauri window around the same `createHarness` runtime as the terminal UI. The webview talks to a loopback bridge started by the Rust process. You should never type that URL into a browser.

## Run

Needs bun and Rust. System `rustup` works. A local toolchain can live in `desktop/.toolchain/` (gitignored).

```bash
# from this repo, or any project
bun bin/harness.ts desktop
```

Or:

```bash
cd desktop
bun install
bun run desktop
```

Paste an OpenRouter key in Settings after the window opens. You do not need to export `OPENROUTER_API_KEY` in the terminal.

`HARNESS_CWD` is the project the agent opens.

The Ink TUI: `bun bin/harness.ts` (same as `caelence`).
