# Phased Effect 4 adoption with durable Stop controls

## Summary

- Pin `effect@4.0.0-rc.109` in the API workspace.
- Migrate orchestration vertically: deep search, idea jobs, then debates.
- Keep Hono, Drizzle commands, Zod, React, AI SDK transport policy, and global `PQueue` scheduling outside Effect.
- Add owner-only Stop actions for root workflows. Browser disconnection never stops work.
- Reuse `interrupted`; direct user stops are distinguished by root-only `cancelRequestedAt`.
- Replace the existing database and migration history with one clean baseline. No backward compatibility or data preservation is required.

## Fresh database schema

- Add nullable `cancel_requested_at` columns directly to the new baseline:
  - `deep_search_jobs`: permitted only for standalone rows.
  - `idea_jobs`: permitted only for standalone rows.
  - `debate_jobs`: always a root.
- Keep existing statuses and define exact lifecycle constraints:
  - `running`: no completion or error; a root may have `cancelRequestedAt`.
  - `completed` and `failed`: `cancelRequestedAt` must be null.
  - `interrupted`: completion timestamp and error required. Direct user-stopped roots retain `cancelRequestedAt`; descendants and restart interruptions leave it null.
- Store cancellation only on the root. Descendants derive effective cancellation through the existing debate → idea → deep-search ownership chain.
- Regenerate a single fresh `0000` migration, Drizzle snapshot/journal, and DBML from the final schema. Remove superseded migration artifacts and recreate the development database.
- Do not add cancellation tables, statuses, indexes, duplicated descendant timestamps, or backfills.

## Cancellation lifecycle

- Implement workflow-specific commands:
  - `requestDeepSearchStop`
  - `requestIdeaStop`
  - `requestDebateStop`
- Each command verifies owner and root status, atomically sets `cancelRequestedAt`, and checks the compare-and-swap result.
- Every transaction that starts work—generations, stages, rounds, queries, pages, children, evaluations, refinements, matches, or messages—must verify that the effective root is still running and uncancelled.
- No provider call starts before its durable work record commits.
- Normal completion/failure requires an uncancelled root. Losing a cancellation race becomes interruption, not failure.
- Already-started callbacks may finish cleanup but cannot create the next stage.
- Recovery handles cancel-requested roots first, including before debate final-verdict recovery, then applies normal restart interruption to remaining work.

## Runtime and Effect boundary

- Each manager keeps an active-run registry containing its root controller, completion, and live event log.
- Debate signals propagate through the owned idea job and every child deep search. Idea signals likewise propagate to their searches.
- Workflow lifetime never uses the Hono request signal.
- Use an in-memory stop reason distinguishing `user-stop` and `parent-stop`. Provider timeouts remain ordinary failures.
- Add a small `Effect.runPromiseExit` boundary that distinguishes success, one tagged `WorkflowFailure`, interruption, and defects.
- Use Effect combinators directly inside migrated coordinators; isolate only Promise, runtime, and `AbortSignal` interop.
- Thread signals through existing AI SDK, search, extraction, and `PQueue` interfaces. Keep all current process-wide queues.
- Extend generation outcomes with `interrupted` and an interruption persistence callback:
  - Queued calls stopped before registration create no generation row.
  - Started calls abort, persist as interrupted, perform stage cleanup, and do not debit RethinkLoop credits.
  - Finalizers wait for durable generation completion before terminalizing the job.
- Reuse existing query/page failed cleanup with stop-specific explanations; do not add nested cancellation states.
- Preserve AI SDK retries/timeouts and the debate-only two-attempt `finishReason === "other"` retry.

## API and events

- Add root-only endpoints:
  - `POST /api/deep-search-jobs/:deepSearchJobId/cancel`
  - `POST /api/idea-jobs/:ideaJobId/cancel`
  - `POST /api/debate-jobs/:debateJobId/cancel`
- Return:
  - `202 { "status": "cancellation-requested" }` for new or repeated active requests.
  - `200 { "status": "interrupted" }` when already user-stopped.
  - 404 for unknown or foreign jobs.
  - 409 for nested or incompatible terminal jobs.
- Persist the cancellation request before aborting the manager-owned controller.
- Expose:
  - `stopRequested`, derived from the effective root.
  - Detail-only `canStop = owner && root && status === "running" && !stopRequested`.
- Deep-search and idea feeds add:
  - `{ "type": "stop-requested" }`
  - `{ "type": "interrupted", "message": "..." }`
- Already-started result events may occur after `stop-requested` while cleanup settles. The terminal suffix is exactly `interrupted`, then `done`, without an ordinary error event.
- Durable replay reconstructs the same sequence.
- Debate feeds remain snapshot-driven: `updated` after request and terminalization, followed by `done`.

## Delivery phases

### 1. Foundation

- Replace schema history with the clean baseline and reset the database.
- Add lifecycle commands, root-resolution guards, recovery precedence, controller registries, inherited signals, Effect runtime bridge, interrupted generation handling, and signal-aware queues.
- Add the shared typed browser cancellation client and MUI Stop confirmation control, initially hidden.

### 2. Deep search

- Convert the coordinator to `Effect.gen`.
- Use concurrent `Effect.all(..., { mode: "result" })` to preserve settle-all behavior and deterministic input-order failure precedence.
- Preserve round limits, fallback rules, event order, quality gates, and final-answer promotion.
- Add the endpoint, projections, events, reducer states, UI, documentation, and focused tests.

### 3. Idea jobs

- Convert planning, child research, summary, generation, evaluation, selection, refinement, and final research fan-outs.
- Propagate Stop to queued and active child searches and await their terminal cleanup.
- Preserve stages, transactions, settle-all behavior, and event order.
- Add the endpoint, projections, replay support, UI, documentation, and focused tests.

### 4. Debates

- Convert matches, rounds, and tournament orchestration.
- Propagate Stop through the idea pipeline, searches, matches, advocates, and judges.
- Prevent new rounds/messages after Stop while retaining completed results.
- Preserve pairings, generation attempts, and retry behavior.
- Add the endpoint, snapshot presentation, UI, documentation, and focused tests.

### 5. Final cleanup

- Render `running + stopRequested` as disabled “Stopping…”.
- Render `interrupted + stopRequested` as “Stopped”; restart cases remain “Interrupted”.
- Use accurate copy: “Completed usage remains charged; stopped in-progress attempts do not debit RethinkLoop credits.”
- Remove obsolete helpers and run the complete verification suite.

## Tests and acceptance

- Verify the single fresh baseline creates the complete schema and passes SQLite `foreign_key_check` and `integrity_check`.
- Test schema lifecycle constraints directly; do not test upgrades from the old schema.
- Cover authorization, root-only enforcement, repeated Stop, cancellation/completion races, and effective-root guards on every work-start boundary.
- Test stopping queued work, active providers, persistence callbacks, child creation, and debate finalization.
- Verify provider deadlines remain failures while manager Stop signals become interruptions.
- Ensure all started work settles durably, no active nested records remain, and interrupted calls do not debit application credits.
- Verify live and replayed event sequences, reconnect while stopping, descendant interruption, and exactly one terminal suffix.
- Preserve existing orchestration parity tests for failure ordering, retries, fallbacks, persistence, replay, and deterministic tournaments.
- Add React and Playwright coverage for each root workflow, including refresh after Stop and descendant propagation.
- Run focused tests after every phase, followed by `npm run gatekeep`, web build, Storybook build, and the full mocked E2E suite.

## Assumptions

- Deleting all existing application data and replacing migration history is explicitly accepted.
- Deployment starts with an empty database created from the new baseline.
- Stop is irreversible and applies only to root workflows.
- No provider fallback, credit reservation, frontend Effect runtime, Effect Schema migration, or resumable provider execution is introduced.
- The application guarantees only its own credit accounting, not upstream provider billing.
