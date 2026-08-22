---
id: 2
title: Move View-the-underlying-idea-generation button to the Standings header
status: review
priority: medium
created: 2026-08-22T16:41:53.196842+01:00
updated: 2026-08-22T23:35:29.704889+01:00
started: 2026-08-22T16:55:17.385748+01:00
class: standard
---

Context: the "View the underlying idea generation" button is currently rendered below the Prompt accordion in src/web/pages/Debates/components/DebateView.tsx:101-108 (alignSelf flex-start), while the "Standings" heading lives inside the TournamentBoard (src/web/pages/Debates/components/TournamentBoard.tsx:166-175, a Stack row with a LeaderboardRounded icon + h2).

Desired behaviour: move the button so it sits at the right end of the "Standings" heading row (e.g. render it in the Standings header Stack with ml:auto, or pass it into TournamentBoard as a prop from DebateView).

The button links to /ideas/{slug} (the idea generation page for the run) — keep the target unchanged.

Tests: src/web/pages/Debates/Debates.test.tsx asserts a link named "View the underlying idea generation" (e.g. lines 248, 756); keep the accessible name working.

[[2026-08-22]] Sat 23:35
## Handoff — ready to merge
- Implemented on branch `task/2-move-idea-generation-button` (commit 2dee46c), verified: web units 270/270, debates e2e 3/3, lint+typecheck clean, Storybook visual confirmed.
- Merge into main is blocked ONLY by uncommitted DebateView.tsx changes on main (task #9 idea-sites WIP from tui@ session).
- To land once #9's work is committed or stashed: `git merge task/2-move-idea-generation-button`, then re-run `npm run test -w @rethinkloop/web`. No conflicts expected — their diff touches WinnerIdeaCard props only.

[[2026-08-22]] Sat 23:35
Ready to merge: task/2-move-idea-generation-button; remaining: git merge after main's DebateView.tsx WIP lands
