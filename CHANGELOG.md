# @useavalon/caelence-agent

## 0.4.0

### Minor Changes

- [#53](https://github.com/useAvalon/caelence-agent/pull/53) [`a9e7a38`](https://github.com/useAvalon/caelence-agent/commit/a9e7a38188c4e8e9eb30736bb6373875c1c24156) Thanks [@MadsHaerup](https://github.com/MadsHaerup)! - Browser control in the user's own Chrome, where they are already signed in.
  
  - `browser.backend: "chrome"` attaches to the running Chrome through Playwright MCP (pinned to 0.0.83) instead of starting a separate signed-out Chrome. Chrome needs the switch at `chrome://inspect/#remote-debugging` turned on once. Until then the first browser call returns those steps, so the agent can pass them on. The default stays `separate`.
  - An agent in this browser acts as the user, so it gets a short allowlist of tools (no JavaScript execution, file upload, or network inspection) and works only in a tab it opened itself. Tests showed `browser_navigate` replaces an existing tab, so closing, switching, and navigating before opening its own tab are refused.
  - The user is asked before the agent opens a site they did not name, clicks a button that commits something (post, send, buy, delete, in English and Danish), accepts a dialog, or clicks any button after typing. The last rule does not depend on wording. These checks are speed bumps in front of a model, not a security boundary.
  - A tool can now ask for approval on one call with `confirm()`. The approval carries a plain `reason`, and neither "always allow", a host's auto-approve mode, nor the decision-model assist can skip it.
  - `browser.app` picks the browser to attach to: `chrome` (default), `edge`, `arc`, `brave`, or `chromium`. Chrome and Edge are found by Playwright. For the others the harness reads the browser's own `DevToolsActivePort` file and attaches by `ws://` address, after checking that something answers on that port, because the file outlives a quit or crash. A browser that is not ready fails closed with setup steps that name it, and never falls through to a different browser.
  - A browser that could not be reached is retried on the next turn with a fresh server, so turning the switch on does not need a restart.
  - A host can pass `trustedHosts` per turn for sites it resolved from the user's words ("x" to x.com).
  - Finds `npx` when the app was started with a bare `PATH`, and keeps Playwright's output files out of the project folder.
  - Exports `COMMIT_RE`, `FIELD_ROLES`, `hostOf`, `hostCovers`, and `hostsInText`, so a host that drives its own browser window can ask about the same clicks and sites.

- [#55](https://github.com/useAvalon/caelence-agent/pull/55) [`79a5a13`](https://github.com/useAvalon/caelence-agent/commit/79a5a1365b38c47844c5f3d5679e1faddd90c80b) Thanks [@MadsHaerup](https://github.com/MadsHaerup)! - Export the Strands agent constructor so a host can run `runTurn` on the harness's own model stack.
  - `createConstructAgent` and `constructOpenRouterProvider` are exported from the package root. Pass `createConstructAgent()` as `constructAgent` in `RunTurnDeps`. The provider reports a missing `OPENROUTER_API_KEY` as a turn error instead of calling the network, streams reasoning, and tracks usage.
  - New type exports: `AgentTool`, `AgentConstructionInput`, `ConstructAgent`, `ConstructedAgent`, `StrandsBackedProvider`, `ToolResult`, and the provider stream types `ProviderMessage`, `ProviderStreamEvent`, `ProviderToolDefinition`, `ProviderTurnRequest`.

- [#52](https://github.com/useAvalon/caelence-agent/pull/52) [`29e4819`](https://github.com/useAvalon/caelence-agent/commit/29e4819df984f4dcc6ec892f19c758bf72d9d3a1) Thanks [@MadsHaerup](https://github.com/MadsHaerup)! - Add extension points so a host app can build on the harness instead of forking it.
  
  - `startDesktopBridge` is exported, with `extensions` for extra routes, settings, model rows, transcript text, and a `beforeTurn` hook that shapes each turn from the request (what the model sees, what the chat stores, per-turn options) or answers without the model.
  - `runTurn` takes `displayMessage`, `systemAppend`, `excludeTools`, `promptOnly`, and `browser` (turn the browser tools on for this turn and the rest of the chat, like `@browser`). The runtime exposes `browserActive`. A host can prefix text the model sees without it reaching the chat, add system text or hide tools for one turn, and ask the user only about chosen requests.
  - `createHarness` takes `intercept` to answer a whole turn without the chat model (for example a computer-use agent) and `systemAppend` for text on every turn. The interceptor gets the user's own words, a `provider(modelId, title)` factory for its own model calls, and the `hostData` the host set for the turn. If it fails after it has already produced output, the turn ends with an error instead of answering twice.
  - The approval gate takes `promptOnly`.
  - More exports: the helpers a host needs to build its own bridge routes.
  - The browser server now starts from an app with a bare `PATH`, such as one launched from the Dock. It finds `uvx` in `~/.local/bin`, `~/.cargo/bin`, and Homebrew when `PATH` does not have it, and asks uv for its own Python 3.11 to 3.13 instead of the system Python 3.9 that browser-use rejects.
  - The `provider` factory an interceptor receives always exists. With a fixed provider it returns that provider.
