---
id: 33
title: Retain safe provider diagnostics for failed LLM generations
status: in-progress
priority: high
created: 2026-10-06T16:59:09.128153+01:00
updated: 2026-10-06T16:59:09.128153+01:00
tags:
    - bug
    - observability
claimed_by: unreeve-bigroot
claimed_at: 2026-10-06T16:59:09.128153+01:00
class: standard
---

Investigated production UX career workflow: four Codex selector calls failed with empty output; the original upstream errors were discarded. User requests significantly better logging. Extend existing server failure diagnostics to correlate provider HTTP attempts, stream failure details, timing and generation/job identifiers while excluding credentials, request/response content and private user data. Preserve public errors, persistence contracts and retry behavior. Prove diagnostics and privacy through the real Pi protocol boundary, run gatekeep, and leave task code in its worktree for review.
