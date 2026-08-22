---
id: 4
title: Link match title to the idea generation page
status: done
priority: medium
created: 2026-08-22T16:41:53.26424+01:00
updated: 2026-08-22T23:52:49.026978+01:00
started: 2026-08-22T16:55:12.722996+01:00
completed: 2026-08-22T23:52:49.027406+01:00
class: standard
---

Context: the match detail page heading at src/web/pages/Debates/components/DebateMatchDetail.tsx:120-126 renders the two idea names as plain text ("X vs Y").

Desired behaviour: make this match title link to the idea generation (run) page, /ideas/{slug} (the same target as the "View the underlying idea generation" button).

Implementation notes: the h1 currently contains both names; make the link wrap the title (or the names) and point to `/ideas/${encodeURIComponent(tournament.slug)}`. Keep overflowWrap:anywhere styling. Tests: src/web/pages/Debates/Debates.test.tsx asserts the match page heading — update if the heading now contains a link.
