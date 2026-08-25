---
id: 14
title: Idea UI shows improved while refinement research is still running
status: done
priority: high
created: 2026-08-24T12:11:45.292312+01:00
updated: 2026-08-25T12:23:23.514749+01:00
started: 2026-08-25T11:09:02.758286+01:00
completed: 2026-08-25T12:23:23.516097+01:00
tags:
    - bug
class: standard
---

The idea generation view still labels an idea as "improved" (and renders the improved card) while the app is still running the refinement research for it. The user sees a finished-looking result that is actually stale or incomplete.

Repro: run an idea job, reach the refinement stage, and note the UI renders refinedIdeas (src/web/pages/Ideas/ideaJobState.ts) as soon as the refined-idea event lands, while the refinement deep search (idea-deep-search-started / refinedIdeaResearch) can still be running.

Scope: this ticket includes a full review of the idea job UI flow. Map every pipeline stage (research -> idea generation -> evaluation -> selection -> refinement -> refinement research -> done) to what the UI shows and label each state honestly (researching, evaluating, refining, researching the improved idea, done). The improved/refined card must only be presented as ready once its refinement research is done, or be explicitly labelled as still in progress. Check the debate snapshot view and any other consumer of the same state for the same issue. Update the idea-job event contract docs (src/api/routes/docs/idea-jobs.md) if the flow changes.

[[2026-08-25]] Tue 11:15
## Handoff
- Current state: Read-only investigation complete; no code files changed.
- Location: /Users/florian/projects/deep-search-debate-ticket-14 on codex/ticket-14-idea-ui-flow.
- Root cause: refined-idea is a completed refinement draft, but IdeaList, IdeaDetailView, SEO metadata, and debate standings treat it as final before supporting research and final evaluation complete.
- Contract fact: actual backend order is selection -> refinement -> refined-idea research -> final evaluation; no parent event identifies research completion or evaluation start.
- Baseline: 36 targeted idea tests pass with Node 26 from board home. Worktree dependencies are not installed.
- Open questions: preserve the actual backend order vs rearrange it; hide refined content until ready vs show a provisional draft and optionally add an evaluation-start event; hide debate standings during stage=ideas vs mark them provisional.
- Next step: re-claim, move to in-progress, add failing regression coverage, implement the confirmed behavior, update stories/docs, and verify.

[[2026-08-25]] Tue 11:19
User confirmed the recommended direction: keep the current backend pipeline; add an evaluation-start event so provisional refined drafts can be labelled Researching/Assessing and only become Improved after evaluation; hide debate standings while the owned idea job is still preparing candidates.

[[2026-08-25]] Tue 11:57
Implemented in /Users/florian/projects/deep-search-debate-ticket-14 on branch codex/ticket-14-idea-ui-flow. Added a durable idea-research-completed boundary plus per-idea evaluation-start events; provisional Researching/Waiting/Assessing states; Improved only after final evaluation; honest split progress and interrupted states; SSR/client SEO parity; and hidden debate candidates during idea preparation while preserving the idea-generation link. Updated live/replay contracts, docs, Storybook states, and regressions. Verified: npm run gatekeep passed (API 613 tests, web 308 tests), focused API/UI suites passed, Storybook build passed, rendered researching/waiting/assessing/completed states inspected with no current browser errors, independent architecture/documentation/simplification/final verification passed. No commit created.

[[2026-08-25]] Tue 12:20
## Review follow-up
- Worktree and branch: /Users/florian/projects/deep-search-debate-ticket-14 on codex/ticket-14-idea-ui-flow.
- Code review fixes: authoritative partial-refinement labels; persisted evaluation validation for SSR/client SEO parity; retained idea-job navigation after terminal idea preparation.
- Story coverage: added selected, improving, waiting-to-refine, waiting-for-assessment, interrupted-assessment, preparing-ideas, and interrupted-preparation stories; corrected impossible/outdated fixtures.
- Verified: focused API 33 tests and web 77 tests passed; npm run gatekeep passed (API 613, web 311); Storybook production build passed; all new lifecycle stories rendered in-browser with no console errors.
- Review notes: independent whole-diff and story-matrix audits completed; no remaining confirmed findings. Task code remains uncommitted.
