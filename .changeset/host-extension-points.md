---
"@useavalon/caelence-agent": minor
---

Add extension points so a host app can build on the harness instead of forking it.

- `startDesktopBridge` is exported, with `extensions` for extra routes, settings, model rows, transcript text, and a `beforeTurn` hook that shapes each turn from the request (what the model sees, what the chat stores, per-turn options) or answers without the model.
- `runTurn` takes `displayMessage`, `systemAppend`, `excludeTools`, `promptOnly`, and `browser` (turn the browser tools on for this turn and the rest of the chat, like `@browser`). The runtime exposes `browserActive`. A host can prefix text the model sees without it reaching the chat, add system text or hide tools for one turn, and ask the user only about chosen requests.
- `createHarness` takes `intercept` to answer a whole turn without the chat model (for example a computer-use agent) and `systemAppend` for text on every turn. The interceptor gets the user's own words, a `provider(modelId, title)` factory for its own model calls, and the `hostData` the host set for the turn. If it fails after it has already produced output, the turn ends with an error instead of answering twice.
- The approval gate takes `promptOnly`.
- More exports: the helpers a host needs to build its own bridge routes.
