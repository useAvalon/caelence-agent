---
"@useavalon/caelence-agent": patch
---

Langfuse tracing loads again in host apps. The OpenTelemetry packages are held to the 2.x line that `@langfuse/otel` supports; the 0.300 line needed a newer `@opentelemetry/api` than hosts had, so tracing stayed off even with both keys set. `createObservability` takes `onUnavailable`, which reports why tracing could not start instead of failing silently.
