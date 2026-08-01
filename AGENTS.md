# AGENTS.md

npm workspaces monorepo for a "deep search debate" app: a Hono + SQLite API (`src/api`) and a Vite + React 19 web client (`src/web`).

Area-specific guidance lives in per-folder `docs/` files (e.g. `src/api/llms/docs/`), all auto-loaded via `opencode.json`. This file holds only cross-cutting orientation.

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

## Area docs

Detailed guidance lives in per-folder `docs/` files. Read the relevant one with your Read tool before working in that area — they hold gotchas you would otherwise miss:

- `src/api/docs/runtime.md` — no build step, `--experimental-strip-types`, required env, external services. Read before touching API startup, config, or imports.
- `src/api/docs/standards.md` — Zod everywhere, `z.function()` pattern, Hono route conventions. Read before adding routes, validation, or service functions.
- `src/api/docs/testing.md` — vitest mock conventions, in-memory SQLite. Read before writing or editing API tests.
- `src/api/llms/docs/prompts.md` — prompt `.md` files and the `PromptName` enum. Read before adding or editing prompts.
- `src/api/db/docs/database.md` — better-sqlite3, committed `data.db`, Drizzle migrations. Read before touching the schema or DB.
- `src/api/routes/docs/text-streaming.md` — the LLM stream lifecycle and NDJSON contract. Read before changing stream routes, generation, or the streaming client.
- `src/api/routes/docs/deep-search-jobs.md` — the deep-search job and event contract. Read before changing the deep-search route, agent events, or frontend subscription.
