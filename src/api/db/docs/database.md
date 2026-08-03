# Database

SQLite accessed through `better-sqlite3` and `drizzle-orm`.

## Native module

`better-sqlite3` is a native module — rebuild it if you change Node version (e.g. after a `brew upgrade node`), or the API will fail to load it.

## The DB file

- `src/api/data.db` is **committed to git**. It is the real dev database, not a fixture.
- It runs in WAL mode (`pragma journal_mode = WAL`), set in `src/api/db/index.ts`.
- Foreign-key enforcement is enabled on the connection.

## Schema and migrations

- Schema modules live in `src/api/db/schema/` and are exported from `schema/index.ts`. Drizzle migrations live in `src/api/drizzle/`.
- After editing the schema, regenerate and apply (run from the api workspace, or via the root proxy):
  ```
  npm run db:generate -w @deep-search-debate/api
  npm run db:migrate   -w @deep-search-debate/api
  ```

Generate the reviewable DBML relationship graph with `npm run db:diagram`. The output is `src/api/db/schema.dbml`.

## Tests

API tests use `DATABASE_URL=:memory:` and apply the committed Drizzle migrations in `db/testSetup.ts`, so they never touch `data.db` and exercise the real migration chain.
