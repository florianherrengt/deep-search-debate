---
id: 9
title: Frontend connection for idea websites
status: in-progress
priority: medium
created: 2026-08-22T18:23:59.167979+01:00
updated: 2026-08-22T21:32:00.353848+01:00
claimed_by: tui@MacBookPro.hyperoptic.com
claimed_at: 2026-08-22T21:32:00.353848+01:00
class: standard
---

Backend serves each selected idea's generated single-file website at GET /api/idea-jobs/:ideaJobId/ideas/:ideaId/website (owner or public-debate viewers; CSP sandbox allow-scripts, no-store). The frontend currently has zero awareness of sites while they generate and no way to view them. Work: (1) publish a website-generation stream event (or stage update) from generateIdeaSite so the client can show live per-idea website progress instead of an opaque running improvement card; (2) add a per-idea website availability signal (field or 200/404 probe) and UI to view each site (iframe or new-tab link); (3) surface per-website failure granularity instead of only the aggregate website stage error.
