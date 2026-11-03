---
"@useavalon/caelence-agent": minor
---
Export the Strands agent constructor so a host can run `runTurn` on the harness's own model stack.
- `createConstructAgent` and `constructOpenRouterProvider` are exported from the package root. Pass `createConstructAgent()` as `constructAgent` in `RunTurnDeps`. The provider reports a missing `OPENROUTER_API_KEY` as a turn error instead of calling the network, streams reasoning, and tracks usage.
- New type exports: `AgentTool`, `AgentConstructionInput`, `ConstructAgent`, `ConstructedAgent`, `StrandsBackedProvider`, `ToolResult`, and the provider stream types `ProviderMessage`, `ProviderStreamEvent`, `ProviderToolDefinition`, `ProviderTurnRequest`.
