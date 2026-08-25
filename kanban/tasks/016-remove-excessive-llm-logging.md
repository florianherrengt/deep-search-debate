---
id: 16
title: Remove excessive LLM logging
status: backlog
priority: low
created: 2026-08-24T12:11:50.587287+01:00
updated: 2026-08-24T12:11:50.587287+01:00
tags:
    - chore
class: standard
---

The API logs are polluted by per-generation info logs. Example: console.info("LLM generation", ...) at src/api/llms/streams.ts:532, and the "LLM generation" label appears across the codebase (errors in generateText.ts, store.ts, persistence.ts).

Audit src/api for per-request/per-generation info logging. Keep only what is operationally useful (failures, terminal job states, resource warnings). Keep or move diagnostics such as token usage and latency to a bounded summary or a debug level rather than per-generation info logs. Update tests that assert the current log output (src/api/llms/streams.test.ts).
