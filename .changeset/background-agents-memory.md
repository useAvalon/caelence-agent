---
"@useavalon/caelence-agent": minor
---

Background agents and pluggable memory.

- `spawn_agent`, `await_agents` and `cancel_agent` start subagents that run while the main agent keeps working. Explore agents are read-only and can run on their own model (`subagents.exploreModel` or `HARNESS_EXPLORE_MODEL`). Hosts build the same tools with `createBackgroundAgents`.
- Memory sits behind a `MemoryStore` interface. Hosts pass their own store to `createHarness`, or implement a `MemoryBackend` and let `createMemoryStore` add validation and ranking. Recall is keyword-only by default; an `Embedder` adds semantic recall (`memory.embeddings` or `HARNESS_MEMORY_EMBEDDINGS`).
- The agent gets `memory_search` and `memory_save` when memory is on.
- `createLayeredMemoryStore` reads several stores as one (a project, then its workspace), writes to the narrowest, and moves a fact wider with `promote`. `synthesizeMemoryBrief` turns a scope's facts into a short brief for the prompt.
