---
id: 24
title: Add the option to set ideas manually and start a debate with them
status: todo
priority: medium
created: 2026-08-25T13:53:40.007623+01:00
updated: 2026-08-25T14:32:34.34552+01:00
started: 2026-08-25T14:32:34.34676+01:00
tags:
    - feature
class: standard
---

Currently the only way to start a debate is from a prompt: POST /api/debate-jobs (createDebateJobInputSchema, src/api/routes/debates/schemas.ts) creates a debate job that owns an idea job, which LLM-generates 6-8 candidate ideas from the prompt (DebatePromptForm on the Debates page submits { prompt, numberOfIdeas }), then researches, selects, and refines them before the tournament (src/api/routes/debates/run.ts waits for the owned idea pipeline to complete and requires every selected idea to be refined). The Ideas page (src/web/pages/Ideas/index.tsx) likewise only generates options from a prompt.

Requested: let the user provide the ideas themselves and run a debate on them.

Confirmed scope (from discussion):
- Entry point: Ideas page. Add an "Enter my own ideas" mode alongside the existing prompt-based "Generate options" button.
- Alternative mode: manual idea entry replaces the prompt -> LLM generation -> selection path; the existing research/refinement pipeline still runs on the manual ideas before the tournament.
- The user must provide 6-8 ideas (same bounds as numberOfIdeas today).
- The debate is then started from those manual ideas. Note: no debate-from-idea-job button exists in the Ideas UI today; starting a debate currently always goes through DebatePromptForm, so a debate-from-idea-job path has to be added.

Open questions for implementation:
- Do manual ideas carry only a title or also a description? (ideas rows require both; debate prompts use both.)
- Is the debate-from-ideas path exposed only for manual idea jobs or reused for generated ones?
- How do manual-idea runs surface in Ideas history and SEO presentation?
