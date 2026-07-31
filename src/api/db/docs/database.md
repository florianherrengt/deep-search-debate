# Database

SQLite accessed through `better-sqlite3` and `drizzle-orm`.

## Native module

`better-sqlite3` is a native module — rebuild it if you change Node version (e.g. after a `brew upgrade node`), or the API will fail to load it.

## The DB file

- `src/api/data.db` is **committed to git**. It is the real dev database, not a fixture.
- It runs in WAL mode (`pragma journal_mode = WAL`), set in `src/api/db/index.ts`.

## Schema and migrations

- Schema lives in `src/api/db/schema.ts`. Drizzle migrations live in `src/api/drizzle/`.
- After editing the schema, regenerate and apply (run from the api workspace, or via the root proxy):
  ```
  npm run db:generate -w @deep-search-debate/api
  npm run db:migrate   -w @deep-search-debate/api
  ```

## Tests

API tests use `DATABASE_URL=:memory:` (set in `vitest.config.ts`), so they never touch `data.db`.
