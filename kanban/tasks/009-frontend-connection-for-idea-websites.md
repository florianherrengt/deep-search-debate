---
id: 9
title: Frontend connection for idea websites
status: done
priority: medium
created: 2026-08-22T18:23:59.167979+01:00
updated: 2026-08-25T11:06:17.06677+01:00
class: standard
---

Backend serves each selected idea's generated single-file website at GET /api/idea-jobs/:ideaJobId/ideas/:ideaId/website (owner or public-debate viewers; CSP sandbox allow-scripts, no-store). The frontend currently has zero awareness of sites while they generate and no way to view them. Work: (1) publish a website-generation stream event (or stage update) from generateIdeaSite so the client can show live per-idea website progress instead of an opaque running improvement card; (2) add a per-idea website availability signal (field or 200/404 probe) and UI to view each site (iframe or new-tab link); (3) surface per-website failure granularity instead of only the aggregate website stage error.

[[2026-08-25]] Tue 11:06
## Closed as superseded — 2026-08-25
Commit 486fd0f ("generate one website for the debate tournament winner") removed per-idea website generation: standalone idea runs no longer produce sites, only the tournament winner does. Item 2 (availability signal + view UI) shipped via `winnerWebsiteIdeaId`/`winnerWebsiteHasScreenshot` in the debate snapshot and WinnerIdeaCard (screenshot preview + open-in-new-tab link). Item 3 (per-website failure granularity) is moot with a single winner site (aggregate "Winning idea website failed"). The only real remaining gap is item 1: no live website-generation stream event — see new ticket #21.
