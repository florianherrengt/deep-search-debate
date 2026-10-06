---
id: 33
title: Retain safe provider diagnostics for failed LLM generations
status: review
priority: high
created: 2026-10-06T16:59:09.128153+01:00
updated: 2026-10-06T17:22:58.72048+01:00
tags:
    - bug
    - observability
class: standard
---

Investigated production UX career workflow: four Codex selector calls failed with empty output; the original upstream errors were discarded. User requests significantly better logging. Extend existing server failure diagnostics to correlate provider HTTP attempts, stream failure details, timing and generation/job identifiers while excluding credentials, request/response content and private user data. Preserve public errors, persistence contracts and retry behavior. Prove diagnostics and privacy through the real Pi protocol boundary, run gatekeep, and leave task code in its worktree for review.

[[2026-10-06]] Tue 17:22
## Handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-33-provider-diagnostics
- Branch: codex/ticket-33-provider-diagnostics; task code remains uncommitted for review.
- Changed: new bounded providerDiagnostics collector; Pi fetch observation; diagnostics forwarding through generation adapters; one structured terminal failure log; focused regression tests; streaming and Coolify operator documentation.
- Verified: Node 26.5.1 npm run gatekeep passed (lint, typecheck, knip, 92 API files / 881 tests, 53 web files / 389 tests); dedicated root and API checklist reviews found no remaining blockers. Corrected strip-only startup compatibility and cancellation propagation issues found during validation.
- Privacy and behavior: no raw prompt/output/provider messages/credentials in logs; no retry, public error, schema, or workflow state changes. Real Pi protocol boundary exercised with synthetic responses, without live provider calls.
- Deployment: not committed, merged, pushed, or deployed. Historical discarded error details cannot be reconstructed; diagnostics will apply to new calls after deployment.
