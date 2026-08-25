---
id: 21
title: Publish a live website-generation progress event for the winner website
status: done
priority: medium
created: 2026-08-25T11:06:20.174889+01:00
updated: 2026-08-25T12:10:57.757141+01:00
started: 2026-08-25T11:27:10.198852+01:00
completed: 2026-08-25T12:10:57.759027+01:00
class: standard
---

The debate tournament's winner website is generated after the final verdict by generateWinningIdeaSite (src/api/routes/ideas/ideaSites.ts), but the pipeline publishes no stream event while it runs: the debate emits only { type: "updated" } once the site has settled (src/api/routes/debates/run.ts). The client therefore shows an opaque running card until the tournament completes, and WinnerIdeaCard only appears after the fact.

Work: publish a website-generation stream event (or stage update) from the debate run so the debates view can show live winner-website progress instead of an opaque running card. Supersedes item 1 of closed ticket #9.

[[2026-08-25]] Tue 11:51
## Handoff
- Location: uncommitted changes in /Users/florian/projects/deep-search-debate-ticket-21 on branch codex/ticket-21-winner-website-progress.
- Changed: reuse the existing final-verdict updated event as the snapshot invalidation; show an accessible indeterminate winner-website status in the live winner card; add timing and Storybook regression coverage; correct the debate event documentation.
- Files changed: src/api/routes/debates/run.test.ts; src/api/routes/docs/debate-jobs.md; src/web/pages/Debates/components/DebateView.tsx; src/web/pages/Debates/components/WinnerIdeaCard.tsx; src/web/pages/Debates/components/DebateView.stories.tsx; src/web/pages/Debates/components/DebateView.stories.test.tsx; src/web/pages/Debates/stories/fixtures.ts.
- Verified: npm run gatekeep passed with lint, typecheck, knip, 612 API tests, and 300 web tests. Focused API 15/15 and Storybook 4/4 passed. Rendered Storybook inspection passed at 1440px and 390px with no browser warnings or errors.
- Integration hint: no new event variant or database stage is needed because the durable final-verdict update already precedes website generation. Ticket #22 must add its persisted generateWebsite choice to the local progress predicate when generation becomes optional.
