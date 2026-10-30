---
"@useavalon/caelence-agent": minor
---

Add extension points so a host app can build on the harness instead of forking it.

- `startDesktopBridge` is exported, with `extensions` for extra routes, settings, model rows, transcript text, and a `beforeTurn` hook that shapes each turn from the request.
- `runTurn` takes `displayMessage`, `systemAppend`, `excludeTools`, and `promptOnly`. A host can prefix text the model sees without it reaching the chat, add system text or hide tools for one turn, and ask the user only about chosen requests.
- `createHarness` takes `intercept` to answer a whole turn without the chat model (for example a computer-use agent) and `systemAppend` for text on every turn. If an interceptor fails after it has already produced output, the turn ends with an error instead of answering twice.
- The approval gate takes `promptOnly`.
- More exports: the helpers a host needs to build its own bridge routes.
