---
id: 39
title: Move used deep-search-core functionality into RethinkLoop
status: in-progress
priority: medium
created: 2026-10-20T16:26:53.659681+01:00
updated: 2026-10-20T16:26:53.659681+01:00
claimed_by: orogeny-rahdaree
claimed_at: 2026-10-20T16:26:53.659681+01:00
class: standard
---

Move only the currently used URL/IP validation, SearXNG, HTML text cleanup and isolated PDF extraction into this repository. Preserve existing behavior, remove the external package completely, and verify with focused tests, gatekeep and relevant workflow E2E tests. User confirmed scope and authorized implementation on 2026-10-20.
