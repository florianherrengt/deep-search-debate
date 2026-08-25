---
id: 14
title: Idea UI shows improved while refinement research is still running
status: backlog
priority: high
created: 2026-08-24T12:11:45.292312+01:00
updated: 2026-08-24T12:11:45.292312+01:00
tags:
    - bug
class: standard
---

The idea generation view still labels an idea as "improved" (and renders the improved card) while the app is still running the refinement research for it. The user sees a finished-looking result that is actually stale or incomplete.

Repro: run an idea job, reach the refinement stage, and note the UI renders refinedIdeas (src/web/pages/Ideas/ideaJobState.ts) as soon as the refined-idea event lands, while the refinement deep search (idea-deep-search-started / refinedIdeaResearch) can still be running.

Scope: this ticket includes a full review of the idea job UI flow. Map every pipeline stage (research -> idea generation -> evaluation -> selection -> refinement -> refinement research -> done) to what the UI shows and label each state honestly (researching, evaluating, refining, researching the improved idea, done). The improved/refined card must only be presented as ready once its refinement research is done, or be explicitly labelled as still in progress. Check the debate snapshot view and any other consumer of the same state for the same issue. Update the idea-job event contract docs (src/api/routes/docs/idea-jobs.md) if the flow changes.
