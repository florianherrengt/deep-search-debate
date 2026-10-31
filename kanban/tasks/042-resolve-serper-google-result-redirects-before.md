---
id: 42
title: Resolve Serper Google result redirects before storing search results
status: in-progress
priority: high
created: 2026-10-31T17:49:09.1963Z
updated: 2026-10-31T17:49:09.1963Z
tags:
    - bug
    - api
claimed_by: purpurin-dialyzer
claimed_at: 2026-10-31T17:49:09.1963Z
class: standard
---

Resolve the complete Serper search response before normalization and persistence. Honor retryAfter within one 120-second total Serper search budget. On resolution failure or deadline exhaustion, return only results with real destination URLs from the latest valid response. Preserve caller cancellation and existing initial-search errors. No new dependencies; leave task code uncommitted for review.
