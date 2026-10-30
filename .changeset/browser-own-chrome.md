---
"@useavalon/caelence-agent": minor
---

Browser control in the user's own Chrome, where they are already signed in.

- `browser.backend: "chrome"` attaches to the running Chrome through Playwright MCP (pinned to 0.0.83) instead of starting a separate signed-out Chrome. Chrome needs the switch at `chrome://inspect/#remote-debugging` turned on once. Until then the first browser call returns those steps, so the agent can pass them on. The default stays `separate`.
- An agent in this browser acts as the user, so it gets a short allowlist of tools (no JavaScript execution, file upload, or network inspection) and works only in a tab it opened itself. Tests showed `browser_navigate` replaces an existing tab, so closing, switching, and navigating before opening its own tab are refused.
- The user is asked before the agent opens a site they did not name, clicks a button that commits something (post, send, buy, delete, in English and Danish), accepts a dialog, or clicks any button after typing. The last rule does not depend on wording. These checks are speed bumps in front of a model, not a security boundary.
- A tool can now ask for approval on one call with `confirm()`. The approval carries a plain `reason`, and neither "always allow", a host's auto-approve mode, nor the decision-model assist can skip it.
- `browser.app` picks the browser to attach to: `chrome` (default), `edge`, `arc`, `brave`, or `chromium`. Chrome and Edge are found by Playwright. For the others the harness reads the browser's own `DevToolsActivePort` file and attaches by `ws://` address, after checking that something answers on that port, because the file outlives a quit or crash. A browser that is not ready fails closed with setup steps that name it, and never falls through to a different browser.
- A browser that could not be reached is retried on the next turn with a fresh server, so turning the switch on does not need a restart.
- A host can pass `trustedHosts` per turn for sites it resolved from the user's words ("x" to x.com).
- Finds `npx` when the app was started with a bare `PATH`, and keeps Playwright's output files out of the project folder.
