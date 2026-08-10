# Database

SQLite accessed through `better-sqlite3` and `drizzle-orm`.

## Native module

`better-sqlite3` is a native module — rebuild it if you change Node version (e.g. after a `brew upgrade node`), or the API will fail to load it.

Better Auth 1.6 requires `better-sqlite3` 12.x. The dependency is declared in
both the API workspace and the root development dependencies because npm
hoists Drizzle to the root; without the root peer, Node cannot resolve
Drizzle's SQLite driver. Keep both declarations on the same version. Knip
ignores this one documented peer-resolution shim.

## The DB file

- SQLite database files are ignored and must never be committed. They contain
  user prompts, GitHub identity data, OAuth tokens, and session records.
- Drizzle migrations are the only schema source of truth. Historical jobs that
  are useful as deterministic examples belong in explicit seed or test fixtures,
  not a mutable database binary.
- It runs in WAL mode (`pragma journal_mode = WAL`), set in `src/api/db/index.ts`.
- Foreign-key enforcement is enabled on the connection.

## Schema and migrations

- Schema modules live in `src/api/db/schema/` and are exported from `schema/index.ts`. Drizzle migrations live in `src/api/drizzle/`.
- Better Auth owns the `user`, `session`, `account`, and `verification` tables.
  GitHub OAuth tokens remain server-side in `account`; application requests use
  an opaque database-backed session cookie rather than a JWT.
- Every root job and every `llm_generations` row has a required `user_id`.
  User-facing reads apply reusable SQL scopes to the query retrieving the root
  resource: an owner match grants private access, while a public debate grants
  inherited access through its idea job, child searches, and generations.
  Inaccessible rows are never loaded before authorization. Nested idea searches,
  debate jobs, and all of their generations inherit the initiating user's ID
  explicitly. Composite
  foreign keys enforce matching owners for root job relationships; transactional
  application validation enforces the same invariant for normalized child rows
  where duplicating `user_id` would add no domain information.
- Debate ownership follows the creation graph: `debate_jobs` owns an optional
  one-to-one `idea_jobs` child, which owns its `deep_search_jobs`. Standalone
  idea and deep-search jobs have no parent. Application writers create these
  ownership links once and never reparent them; under that contract, deleting a
  debate cascades through its complete generated pipeline.
- Workflow-created `llm_generations` rows carry exactly one debate, idea, or
  deep-search owner FK; standalone stream generations carry none. Root
  generation links include the exact job ID and user ID in their composite
  foreign keys. Generation ownership is immutable after insertion so deleting
  any job always cascades to exactly the generations it created;
  `NO ACTION` on generation-use links protects direct partial deletion while
  permitting the aggregate cascade. Generations created directly through
  `POST /api/streams` are deliberately standalone and are deleted with their
  user rather than an unrelated job.
- Query, page, and result lifecycle checks couple each active or terminal stage
  to its valid timestamps, errors, generation links, and selected-page links.
  SQLite triggers require a selected page to share both the result URL and the
  query's deep-search job. The query-generation, generated-query, query, and
  persisted-page ownership links used by that check are immutable after
  insertion so later updates cannot invalidate an existing selected result.
- API validation requires user prompts, research requests, generated queries,
  and persisted search facts to contain non-whitespace content. Idea content is
  immutable after insertion; its nullable critique and refinement links can
  each transition exactly once from absent to present, its nullable selected
  flag can transition exactly once from pending to true or false, its refined
  title/description commit as a pair, and its selected-idea search link attaches
  once. Ownership triggers require refinement generations to belong to the same
  idea job and selected-idea searches to use that job's reserved
  `deepSearchCount + idea.position`. Terminal jobs reject collection additions,
  and deleting the owning job still cascades through the ideas and searches.
- Child-key indexes support aggregate cascades and `NO ACTION` checks without
  scanning unrelated generations, queries, pages, results, or debate matches.
- All database timestamps use Unix milliseconds. Ordered records use explicit
  scoped positions; timestamps are metadata and history queries use stable IDs
  as their final tie-breaker.
- After editing the schema, regenerate and apply (run from the api workspace, or via the root proxy):
  ```
  npm run db:generate -w @rethinkloop/api
  npm run db:migrate   -w @rethinkloop/api
  ```
- The API workspace's `predev` and `prestart` lifecycle scripts apply pending
  migrations before either development or production startup.
- Keep applied migrations immutable and add forward migrations for schema
  changes. `baselineMigration.test.ts` verifies both a fresh database and an
  upgrade from the original baseline through the same Drizzle migrator used by
  the application.

### Known application-enforced integrity boundaries

- `ideas.critique_generation_id` is null during the valid interval between idea
  persistence and that idea's critique call starting. A trigger permits only the
  one-time null-to-generation transition. Its foreign key and unique index
  prevent nonexistent or reused generations, while application orchestration
  enforces same-job ownership and requires every link before job completion,
  without duplicating `user_id` on every idea row.
- `ideas.selected` is null from insertion until comparative selection commits.
  The selector's terminal transaction updates the complete idea batch to true
  or false. Application validation enforces an unordered, unique, same-job,
  even selected set containing 6 through 100 ideas; the idea immutability
  trigger permits only the one-time null-to-boolean transition.
- Selected ideas use four nullable columns rather than an extra lifecycle table:
  `refinement_generation_id`, `refined_title`, `refined_description`, and
  `deep_search_job_id`. A lifecycle check requires these fields to remain empty
  for rejected ideas, allows the generation link while refinement is running,
  and requires both refined fields before a search can attach. Triggers enforce
  same-job refinement ownership and the selected idea's exact child-search
  position.
- `idea_jobs.selection_generation_id` has a normal generation foreign key and
  unique index. Insert/update triggers additionally require that generation to
  carry the same user and idea-job owner, preserving the composite ownership
  invariant without rebuilding the referenced `idea_jobs` table in migration.
- Aggregate parent columns such as `idea_jobs.debate_job_id`,
  `deep_search_jobs.idea_job_id`, and the debate round/match parent links are not
  immutable in SQLite. Application writers treat them as insert-only. Direct SQL
  or maintenance code must not reparent existing records; doing so can detach
  generated data from the root whose deletion is expected to cascade through it.
- Lifecycle checks validate legal combinations of status, result, error, and
  timestamp fields, but most do not enforce one-way state transitions. Application
  writers treat terminal jobs, matches, queries, pages, and generations as
  immutable. Direct SQL must not rewrite outcomes or reopen terminal records.
- Except for completed LLM output, SQLite content checks use `trim(value)`, which
  removes ASCII spaces but not tabs or newlines. Zod and stream-boundary validation
  reject general whitespace-only input. Direct SQL must not rely on those CHECKs
  to reject strings containing only non-space whitespace.

Generate the reviewable DBML relationship graph with `npm run db:diagram`. The output is `src/api/db/schema.dbml`.

## Durable job models

- `llm_generations` stores terminal text, reasoning, status, errors, and the
  owning job for every replayable workflow model invocation. Live deltas remain
  in memory and are never written individually. The short preflight title call
  is not replayed; only its validated title is stored on the new job.
- `deep_search_jobs` owns an LLM-generated title, readable slug, and deep-search
  request and may belong to an `idea_jobs` parent. Child searches store their
  planning-generation position. Its normalized query, result, web-page, and
  generation rows preserve research progress without a JSON snapshot.
- `idea_jobs` owns the LLM-generated title and slug used by both idea and debate
  URLs, the user prompt, requested idea/search counts, current stage,
  lifecycle, planning, briefing, idea-generation, and selection-generation
  links. A debate-created idea job points to its owning debate; a standalone
  idea job leaves that FK null.
- `ideas` stores validated, ordered idea output with stable IDs as soon as idea
  generation completes. Its critique-generation link is initially null and is
  attached when that idea's critique starts. Its selected flag remains null
  until the comparative selector atomically marks every idea selected or
  rejected. Each critique's text and reasoning remain in its `llm_generations`
  row; they are not copied into `ideas` or a second critique table. A selected
  row then stores its one-time refinement generation, improved title and
  description, and direct child-search link. The job's idea- and
  selection-generation links separately retain raw structured output and
  selector reasoning for inspection and debugging.
- `debate_jobs` owns its generated idea pipeline as well as
  `debate_rounds`, `debate_matches`, and `debate_messages`. These tables store
  pairings, machine-readable winners, and transcript-generation links. Matches
  reference only selected stable ideas directly; standings, Elo, and expected
  match counts remain derived from completed matches and the admitted field.
  Its private-by-default `is_public` flag grants anonymous
  read access to this complete owned aggregate without exposing the owner.
- An idea job does not copy child research output or sources. Its child
  `deep_search_jobs` keep their own durable state. Initial child final answers
  feed the shared briefing; each selected idea's later child final answer is
  resolved through `ideas.deep_search_job_id` for debate context and UI replay.

On startup, `recoverInterruptedWork()` marks orphaned running LLM generations, deep-search work, idea jobs, and debate jobs as interrupted or failed. A debate whose final verdict already committed is instead recovered as completed, closing the small crash window before the parent job's terminal update. External provider work is not resumable after process termination; completed debate rounds, results, and transcript generations remain replayable.

## Tests

API tests use `DATABASE_URL=:memory:` and apply the committed Drizzle migrations in `db/testSetup.ts`, so they never touch `data.db` and exercise the real migration chain. Playwright creates a unique temporary database, migrates it before starting the API, and removes it after the run.
