---
id: 38
title: Fix four page extraction false positives and documentation pruning
status: in-progress
priority: high
created: 2026-10-20T14:02:51.731723+01:00
updated: 2026-10-20T14:02:51.731723+01:00
tags:
    - bug
    - api
claimed_by: phacoid-beetler
claimed_at: 2026-10-20T14:02:51.731723+01:00
class: standard
---

Fix the four failures reproduced during Browserless diagnosis: Mozilla Client Challenge accepted as evidence; legitimate CAPTCHA documentation rejected; inline script NUL bytes reject valid HTML; CSS custom-property classes cause shared sanitizer to prune documentation. User confirmed all fixes must remain inside RethinkLoop. Preserve real challenge, binary, hidden/noise, JSON/PDF, URL and credit behavior. No retrieval-method persistence or deployment in this task.
