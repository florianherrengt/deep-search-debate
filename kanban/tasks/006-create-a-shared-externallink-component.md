---
id: 6
title: Create a shared ExternalLink component
status: done
priority: high
created: 2026-08-22T16:46:36.124306+01:00
updated: 2026-08-24T01:58:07.445269+01:00
started: 2026-08-22T16:54:28.705499+01:00
completed: 2026-08-24T01:58:07.445723+01:00
class: standard
---

Context: several places render links that open in a new tab with an OpenInNew icon. The established visual pattern (color + icon) appears in:

- src/web/pages/Ideas/components/ResearchProgress.tsx:11-23 — MUI Link (default primary color) + inline <OpenInNew aria-hidden fontSize="inherit" sx={{ ml: 0.5, verticalAlign: "text-bottom" }} />, rel="noopener noreferrer", target="_blank", external href.
- src/web/pages/Debates/components/WinnerIdeaCard.tsx:48-67 — same icon treatment but react-router "to" instead of href, link color: "inherit".
- src/web/pages/Debates/components/DebateMatchDetail.tsx:143-157 — outlined Button with endIcon={<OpenInNew />} linking to an internal page in a new tab.

Desired behaviour (confirmed):
1. Create a reusable component (suggested name ExternalLink, suggested location src/web/components/ExternalLink.tsx) that encodes this pattern: MUI Link + OpenInNew icon rendered inline after the label (aria-hidden, fontSize inherit, ml 0.5, verticalAlign text-bottom), rel="noopener noreferrer", target="_blank".
2. Support both external hrefs AND react-router "to" (internal pages opened in a new tab, like WinnerIdeaCard).
3. Match the existing color treatment: default primary, with the "inherit" variant used in headings.
4. Refactor the existing usages above to use it, keeping their current appearance. Note: DebateMatchDetail renders an outlined Button — preserve its button look during the refactor (either the component supports a button variant or that spot keeps Button + endIcon).

Follow src/web/docs/standards.md (MUI primitives preferred; icons combined with text need accessible naming; no hardcoded colors). Add a Storybook story (pattern: src/web/components/JobHistory.stories.tsx) and a unit test (pattern: src/web/components/ResultFeedback.test.tsx) covering: new-tab target, rel, icon rendered, href vs react-router "to".

[[2026-08-22]] Sat 23:15
## Handoff
- Current state: implemented, committed, full gate green (lint, typecheck, knip, 820 tests) in worktree .worktrees/task-6-shared-external-link
- Branch: task/6-shared-external-link (rebased on main 1d12a16, commit 1d43e37)
- New: src/web/components/ExternalLink.tsx (+ story + test); refactored ResearchProgress.tsx and WinnerIdeaCard.tsx (2 links) to use it. DebateMatchDetail keeps its outlined Button + endIcon per task note.
- Blocker: board-home main has uncommitted WIP touching WinnerIdeaCard.tsx (new 'Open the generated website' MuiLink) — merge would overwrite/conflict with uncommitted changes. Commit or stash the WIP, then: git merge task/6-shared-external-link
- Optional follow-up: the new website link in WinnerIdeaCard could adopt ExternalLink (it currently has no OpenInNew icon — judgement call)
- Next step: after user WIP is committed, merge, re-run npm run gatekeep, mark done

[[2026-08-22]] Sat 23:26
[[2026-08-22]] Review fix: added inherit-color unit test. Branch now at ea30338; lint, typecheck, and all 271 web tests green. Still blocked on user WIP in WinnerIdeaCard.tsx before merge.

[[2026-08-22]] Sat 23:26
[[2026-08-22]] Review fix: added inherit-color unit test. Branch now at ea30338; lint, typecheck, and all 271 web tests green. Still blocked on user WIP in WinnerIdeaCard.tsx before merge.

[[2026-08-23]] Sun 00:18
[[2026-08-23]] Added variant="button" (outlined Button + endIcon, aria-hidden) to ExternalLink; converted DebateMatchDetail idea links. New ButtonVariant story + test. Branch at 2f27629; lint/typecheck/knip/272 web tests green. Storybook on :6006 hot-reloaded.

[[2026-08-23]] Sun 00:42
## Handoff
- Current state: implemented + scope extended (user-approved) with button variant; branch task/6-shared-external-link at 0cd64fe, all gates green (lint/typecheck/knip/272 web tests)
- Now covers: ResearchProgress, WinnerIdeaCard x2, DebateMatchDetail (button), SearchResultCard (icon added, rel normalized), IdeaDetailView research link (buttonVariant=text). New props: variant=button + buttonVariant, both discriminated-union guarded.
- Remaining follow-up #1 (user-approved): convert the WIP 'Open the generated website' link in board-home WinnerIdeaCard.tsx to ExternalLink — blocked until user commits that WIP (board home lacks ExternalLink.tsx until merge). Do it during merge resolution; note it needs a Typography variant=body2 treatment (wrap in Typography or extend component).
- Next step: user commits WIP -> git merge task/6-shared-external-link (resolve WinnerIdeaCard: keep both sides, convert website link) -> npm run gatekeep -> move to done
