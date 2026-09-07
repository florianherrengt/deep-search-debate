---
id: 27
title: Fix Pi OpenAI URL schema compatibility
status: review
priority: high
created: 2026-09-07T10:00:54.349529+01:00
updated: 2026-09-07T11:31:19.72474+01:00
tags:
    - bug
class: standard
---

Confirmed production HTTP 400 invalid_function_parameters: strict submit_structured_output schema includes unsupported format uri in research-analysis source URLs. Preserve Zod URL validation, adapt only the OpenAI provider schema, add regression coverage, validate, deploy and resume saved café debate 079f84b6-af55-4a46-b486-5b6445935ce6. User approved fixing this compatibility bug and resuming.

[[2026-09-07]] Mon 10:11
Implementation ready for review in /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-27-pi-url-schema on codex/ticket-27-pi-url-schema; task code remains uncommitted. Changed generateText.ts, generateText.structured.test.ts, routes/docs/text-streaming.md. Codex-only Zod JSON Schema conversion omits unsupported URI format; original URL/protocol parsing and server schemas remain intact. Regression captured the exact failing Pi HTTP payload before the fix. Focused 34 tests passed; canonical lint/typecheck/knip and 719 API + 346 web tests passed. Dedicated root/API reviews clean. Live same-account Sol/Pi schema-only probe returned HTTP200 and output passed original Zod schema. No release/deployment or debate Resume performed this turn. Pending user approval to commit the release, deploy, and resume saved debate 079f84b6-af55-4a46-b486-5b6445935ce6.

[[2026-09-07]] Mon 11:18
User explicitly authorized always committing and deploying verified fixes and trying the debate; proceeding with the reviewed schema fix, release and live resume without another approval checkpoint.

[[2026-09-07]] Mon 11:31
Committed reviewed fix as ec74e0a74b61fe605569f70986aba72a38cd38cb on codex/ticket-27-pi-url-schema and published/deployed that exact image. Coolify deployment qtz6mp3dgu2fq5vww6dx5kze finished; application and public health passed. Running image digest verified sha256:698a72810e0245d4413af9555d98b0bb7a94efeacd09ae27bb4404fff82ce1b1. Existing debate 079f84b6-af55-4a46-b486-5b6445935ce6 resumed automatically from persisted research. Formerly failing analyze-research-answer generation 8293b47b-49d6-406b-ae23-dcecdd8009d9 completed on gpt-5.6-sol with stop finish and zero app credits; original schema validates its 12 facts, 2 disagreements, 12 gaps, 11 assumptions, and 23 source URLs. Initial research and summary completed; candidate idea generation is running. Tournament completion is not yet verified. All 1065 canonical tests passed before release; worktree clean. No Git push or merge requested/performed; keeping ticket in review per board integration rules.
