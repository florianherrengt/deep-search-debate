# AGENTS.md

npm workspaces monorepo for a "deep search debate" app: a Hono + SQLite API (`src/api`) and a Vite + React 19 web client (`src/web`).

Area-specific guidance lives in per-folder `docs/` files (e.g. `src/api/llms/docs/`). This file holds only cross-cutting orientation and indexes the scoped documents that must be read before changing those areas.

## Layout

- `src/api` → `@deep-search-debate/api`: Hono backend. Entry `server.ts` → `index.ts` (app). All routes mount under the `/api` basePath.
- `src/web` → `@deep-search-debate/web`: Vite + React 19 + MUI + React Query + React Router. Entry `main.tsx` → `App.tsx`.
- Root `package.json` scripts proxy into workspaces with `-w @deep-search-debate/{api,web}`.

## Commands

- **Pre-PR gate:** `npm run gatekeep` — runs `lint → typecheck → knip → test` in that order. This is the canonical verification step.
- **Per-workspace:** e.g. `npm run test -w @deep-search-debate/api`, `npm run dev -w @deep-search-debate/web`.
- **Dev (full stack):** run `npm run dev` (API on :3000) **and** `npm run dev:web` (Vite) together. Vite proxies `/api` → `http://localhost:3000`.

## Lint / style

- ESLint flat config, type-checked (`recommendedTypeChecked`). Unused vars are allowed only when prefixed `_`.
- Knip is configured (`knip.json`, with `src/api/db/index.ts` registered as an api entry) and is part of `gatekeep`.

## Review checklists

The repository has living checklists for recurring engineering mistakes. Read a checklist only when the current work touches its scope:

- `gatekeep.md` — read for repository-wide configuration, tooling, shared contracts, or changes spanning multiple areas.
- `src/api/gatekeep.md` — read for backend, orchestration, LLM, persistence, or streaming changes.
- `src/api/db/schema/gatekeep.md` — read for relational design, Drizzle schema, migration, or DBML changes.
- `src/web/gatekeep.md` — read for React, browser persistence, streaming UI, Storybook, accessibility, or frontend testing changes.
- `docs/gatekeep.md` — read only when adding, removing, reorganizing, or updating gatekeep checklist entries.

Do not load unrelated checklists. These files supplement scoped documentation and the executable `npm run gatekeep` command; they replace neither. Keep checklist entries feature-independent and update or remove them when the architecture changes.

## Area docs

Detailed guidance lives in per-folder `docs/` files. Read the relevant one with your Read tool before working in that area — they hold gotchas you would otherwise miss:

- `src/api/docs/runtime.md` — no build step, `--experimental-strip-types`, required env, external services. Read before touching API startup, config, or imports.
- `src/api/docs/standards.md` — Zod everywhere, `z.function()` pattern, Hono route conventions. Read before adding routes, validation, or service functions.
- `src/api/docs/testing.md` — vitest mock conventions, in-memory SQLite. Read before writing or editing API tests.
- `src/api/llms/docs/prompts.md` — prompt `.md` files and the `PromptName` enum. Read before adding or editing prompts.
- `src/api/db/docs/database.md` — better-sqlite3, committed `data.db`, Drizzle migrations. Read before touching the schema or DB.
- `src/api/routes/docs/text-streaming.md` — the LLM stream lifecycle and NDJSON contract. Read before changing stream routes, generation, or the streaming client.
- `src/api/routes/docs/deep-search-jobs.md` — the deep-search job and event contract. Read before changing the deep-search route, agent events, or frontend subscription.
- `src/api/routes/docs/idea-jobs.md` — the researched-idea pipeline, child searches, failure policy, persistence, and event contract. Read before changing idea routes, stages, events, or frontend subscription.
