---
"@useavalon/caelence-agent": minor
---

Status verbs. A turn starts with a `status` event carrying a few verbs ("Pondering", "Brewing") that the terminal UI and the desktop rotate through while the agent is thinking. The built-in list is on by default; `statusVerbs` in the config adds themed `categories` or `custom` verbs, or turns them off. Hosts that call `runTurn` pass `statusVerbs` with a pool from `resolveStatusVerbPool`.
