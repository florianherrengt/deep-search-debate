---
id: 3
title: Show idea names on match Previous/Next buttons
status: done
priority: medium
created: 2026-08-22T16:41:53.234387+01:00
updated: 2026-08-22T23:47:06.229747+01:00
started: 2026-08-22T16:55:15.007492+01:00
completed: 2026-08-22T23:47:06.230159+01:00
class: standard
---

Context: on the match detail page (where the agent debate conversation is shown), the Previous/Next buttons at src/web/pages/Debates/components/DebateMatchDetail.tsx:85-108 currently display generic "Previous"/"Next" text. The adjacent match names are already computed (getAdjacentMatches, matchName -> "A versus B") and used only in the aria-labels ("Previous: A versus B").

Desired behaviour: replace the visible button text with the adjacent match's idea names, "A versus B" only (no "Previous:"/"Next:" prefix in the visible label), keeping the arrow icons to convey direction. Long titles will need to wrap or be truncated so buttons stay usable.

Keep or adjust the aria-labels so screen-reader users still get the direction ("Previous: ..."/"Next: ...").

Tests: src/web/pages/Debates/Debates.test.tsx:571-580 asserts links named "Previous: First idea versus Second idea" — update if the accessible names change.
