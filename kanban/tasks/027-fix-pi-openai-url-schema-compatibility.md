---
id: 27
title: Fix Pi OpenAI URL schema compatibility
status: review
priority: high
created: 2026-09-07T10:00:54.349529+01:00
updated: 2026-09-07T10:11:45.790391+01:00
tags:
    - bug
blocked: true
block_reason: Awaiting user approval to commit the reviewed release before deployment and debate resume.
class: standard
---

Confirmed production HTTP 400 invalid_function_parameters: strict submit_structured_output schema includes unsupported format uri in research-analysis source URLs. Preserve Zod URL validation, adapt only the OpenAI provider schema, add regression coverage, validate, deploy and resume saved café debate 079f84b6-af55-4a46-b486-5b6445935ce6. User approved fixing this compatibility bug and resuming.

[[2026-09-07]] Mon 10:11
Implementation ready for review in /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-27-pi-url-schema on codex/ticket-27-pi-url-schema; task code remains uncommitted. Changed generateText.ts, generateText.structured.test.ts, routes/docs/text-streaming.md. Codex-only Zod JSON Schema conversion omits unsupported URI format; original URL/protocol parsing and server schemas remain intact. Regression captured the exact failing Pi HTTP payload before the fix. Focused 34 tests passed; canonical lint/typecheck/knip and 719 API + 346 web tests passed. Dedicated root/API reviews clean. Live same-account Sol/Pi schema-only probe returned HTTP200 and output passed original Zod schema. No release/deployment or debate Resume performed this turn. Pending user approval to commit the release, deploy, and resume saved debate 079f84b6-af55-4a46-b486-5b6445935ce6.
