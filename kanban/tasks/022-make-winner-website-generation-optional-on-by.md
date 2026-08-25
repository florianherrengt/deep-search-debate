---
id: 22
title: Make winner-website generation optional — on by default in UI, off by default via MCP
status: backlog
priority: low
created: 2026-08-25T11:08:13.590931+01:00
updated: 2026-08-25T11:08:30.663798+01:00
tags:
    - feature
    - mcp
class: standard
---

## Goal
Allow disabling website generation when generating ideas, so MCP callers do not pay the ~65k-token website generation cost/latency they never see. Defaults differ by entry point: **enabled by default in the UI**, **disabled by default when invoked via MCP**.

## Verified context (2026-08-25)
- The only website generated in an idea flow today is the debate tournament **winner** website: `generateWinningIdeaSite` (src/api/routes/ideas/ideaSites.ts:182), awaited in the debate run before completion (src/api/routes/debates/run.ts:665-676) and fatal on failure. Standalone idea runs generate no websites.
- Debate creation input: `createDebateJobInputSchema` (src/api/routes/debates/schemas.ts:13) — `createIdeaJobInputSchema` extended with `numberOfIdeas`, `isPublic`, etc. A `generateWebsite: z.boolean()` flag belongs here.
- When skipped: debate completes without the site; snapshot `winnerWebsiteIdeaId`/`winnerWebsiteHasScreenshot` (src/api/routes/debates/snapshot.ts) stay null and `WinnerIdeaCard` (src/web/pages/Debates/components/WinnerIdeaCard.tsx) renders no site link. A skipped/failed website must not be fatal when the flag is off.

## Work
1. API: add `generateWebsite` boolean to `createDebateJobInputSchema` (default per-caller, see 3), thread it to the debate run, and skip `generateWinningIdeaSite` when false.
2. UI (src/web): debate creation flow sends `generateWebsite: true` by default (explicit default-on, since the API default must stay off for MCP); optionally expose a checkbox so users can opt out.
3. MCP (relates to ticket #18 `start_debate`): pass `generateWebsite: false` by default (no new MCP flag needed in v1 — off is the MCP default).
4. Failure policy: when generation is enabled it stays fatal as today; when disabled, nothing website-related can fail the job.
5. Tests: schema default per entry point, snapshot without website, debate completion with `generateWebsite: false`, UI toggle if added.

Note: when generation is skipped there is also no website-progress event (cf. ticket #21), so the client must not show the winner website affordance at all.
