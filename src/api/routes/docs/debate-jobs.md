# Debate jobs

Debate jobs are durable automatic tournaments. A fresh user prompt first runs the
existing researched-idea pipeline, then admits its complete normalized idea set to
Swiss play and a top-four knockout. Closing or reloading the page does not cancel
work. Live subscriptions replay retained events and terminal jobs rebuild their UI
snapshot from SQLite.

## Tournament format

The single format is defined by `DEBATE_TOURNAMENT_FORMAT` in
`routes/debates/tournament.ts`:

- 12 ideas, all produced by the debate's idea job
- five Swiss rounds with six matches per round
- one debate per idea per Swiss round and no repeated Swiss opponents
- wins, then Elo, two-way head-to-head when applicable, then seeded random order
- initial Elo 1500, K-factor 32, with a round's rating changes applied simultaneously
- semifinal pairings 1-v-4 and 2-v-3, followed by one final
- no draws and 33 total matches

Pairings and judge presentation slots are deterministic from the persisted random
seed. Presentation order is randomized and neither rankings nor prior matches enter
an advocate or judge prompt.

Every match runs both openings concurrently, then both rebuttals concurrently,
then one structured judge verdict. All matches in the same round also run
concurrently. Advocates receive only the current matchup, original prompt, research
briefing, and completed child deep-search answers. The judge receives that same
evidence plus the complete current transcript.

Debate-owned idea and deep-search LLM calls set `maxRetries` to zero. Any model
failure therefore fails the tournament with its original error instead of being
hidden by an SDK retry. Standalone idea and deep-search requests retain the SDK's
default retry behavior.

## HTTP contract

Every endpoint requires a Better Auth session. Creation records the authenticated
user on the debate and its atomic idea-job parent; history includes only that
user's jobs, and foreign detail/event UUIDs return 404. Every nested model stream
inherits the same owner.

### `POST /api/debate-jobs`

Starts idea generation and the automatic tournament. It returns `202 Accepted`:

```json
{ "prompt": "Design a practical low-friction energy product" }
```

```json
{ "debateJobId": "<uuid>", "slug": "low-friction-energy-products" }
```

The `Location` header points to `/api/debate-jobs/:slug`. Debate creation reuses
the generated title and slug stored by its owned idea job.

### `GET /api/debate-jobs`

Returns newest-first history as `{ "debateJobs": [...] }`. Each summary contains
`debateJobId`, `ideaJobId`, `title`, `slug`, `prompt`, `stage`, `status`, `error`,
`createdAt`, and `completedAt`. The optional `limit` query defaults to 100 and is
capped at 200.

### `GET /api/debate-jobs/:slug`

Returns `{ "debateJob": ... }`, containing the durable job state plus every round,
match, transcript message, current derived Swiss standings, and the expected match
count. Transcript messages link to `/api/streams/:llmGenerationId` while live and
contain terminal text after persistence. The final match's winner is the tournament
winner. Unknown slugs return 404.

### `GET /api/debate-jobs/:debateJobId/events`

Returns replay-and-follow NDJSON. `updated` means clients should refresh the durable
snapshot. A failed job emits `error` with its exact message. Every terminal stream
ends with `done`. After restart, terminal events are synthesized from SQLite.

## Persistence and recovery

- `debate_jobs` owns one same-owner `idea_jobs` child and stores lifecycle,
  stage, and deterministic random seed. The child carries the FK so deleting a
  debate cascades through its ideas, child searches, normalized research rows,
  tournament rows, and every job-owned LLM generation.
- The owned idea job also stores the debate's generated title and slug, avoiding
  a duplicate copy on `debate_jobs`.
- `debate_rounds` and `debate_matches` store pairings and machine-readable winners.
- `debate_messages` links ordered transcript entries to durable, same-owner LLM
  generations; ownership is validated before each transcript link is written.
- A judge generation's terminal output, verdict-message link, winner, and match
  completion timestamp commit in one transaction. A failed completion hook rolls
  the generation terminal write back instead of leaving a half-linked verdict.
- Wins, Elo, standings, prior pairings, qualification, and the winner projection are
  derived rather than duplicated.
- Round creation validates same-job membership, unique round appearances, stage
  match counts, prior-stage completion, and non-repeating Swiss opponents before
  inserting the complete round transactionally.
- The debate row is created first and its owned idea row is inserted in the same
  transaction before provider work starts, so a parent-row failure cannot leave
  an orphan idea run.

Provider work cannot resume after an API-process restart. Startup recovery marks
orphaned running debate jobs and generations interrupted while preserving completed
rounds, match results, and transcript text for replay. The exception is a running
job whose final verdict and winner already committed atomically: recovery recognizes
that completed final and closes the parent tournament as completed.
