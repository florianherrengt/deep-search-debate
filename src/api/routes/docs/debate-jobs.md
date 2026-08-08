# Debate jobs

Debate jobs are durable automatic tournaments. A fresh user prompt first runs the
existing researched-and-critiqued idea pipeline, then admits its complete normalized
idea set to Swiss play and a top-four knockout. The critique remains available on
the linked idea-job view; tournament agents do not consume it. Closing or reloading
the page does not cancel work. Live subscriptions replay retained events and
terminal jobs rebuild their UI snapshot from SQLite.

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

Creation, history, and visibility changes require a Better Auth session. Creation
records the authenticated user on the debate and its atomic idea-job parent;
history includes the viewer's private debates and every public debate. Debates
are private by default.

Detail and event reads allow either the owner or any viewer when the debate is
public. Public read access follows the aggregate into the debate-owned idea job,
its child deep searches, and every job-owned model stream, so anonymous viewers
can inspect the same live research and tournament content. Private, revoked,
foreign, and unknown UUIDs return 404. Read responses never expose the owner's
user ID or identity.

### `POST /api/debate-jobs`

Starts idea generation and the automatic tournament. It returns `202 Accepted`:

```json
{
  "prompt": "Design a practical low-friction energy product",
  "isPublic": false
}
```

```json
{ "debateJobId": "<uuid>", "slug": "low-friction-energy-products" }
```

The `Location` header points to `/api/debate-jobs/:slug`. Debate creation reuses
the generated title and slug stored by its owned idea job. `isPublic` is optional
and defaults to `false`.

### `GET /api/debate-jobs`

Returns newest-first history as `{ "debateJobs": [...] }`. Each summary contains
`debateJobId`, `ideaJobId`, `title`, `slug`, `prompt`, `isPublic`, `stage`,
`status`, `error`, `createdAt`, and `completedAt`. The optional `limit` query
defaults to 100 and is capped at 200. The read scope includes owned private
debates and public debates.

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

### `PATCH /api/debate-jobs/:debateJobId`

The authenticated owner may update one or more mutable debate fields. The
currently supported field publishes or revokes a debate at any time:

```json
{ "isPublic": true }
```

It returns the debate's current mutable fields as `{ "isPublic": true }`.
Non-owners and unknown UUIDs receive 404. Revoking visibility makes new
anonymous requests to the debate and every nested resource return 404.

## Persistence and recovery

- `debate_jobs` owns one same-owner `idea_jobs` child and stores lifecycle,
  stage, deterministic random seed, and public visibility. The child carries the FK so deleting a
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
