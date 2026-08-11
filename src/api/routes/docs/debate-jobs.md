# Debate jobs

Debate jobs are durable automatic tournaments. A fresh user prompt first runs
the existing researched, critiqued, selected, refined, and individually
researched idea pipeline, then admits only its selected normalized ideas to
Swiss play and a top-four knockout. The
selection agent consumes critiques, but tournament advocates and judges do not.
Critiques and the selection output remain available on the linked idea-job view.
Closing or reloading the page does not cancel work. Live subscriptions replay
retained events and terminal jobs rebuild their UI snapshot from SQLite.

## Tournament format

The format is defined by `DEBATE_TOURNAMENT_FORMAT` and the participant-count
helpers in `routes/debates/tournament.ts`:

- an even selected field from 6 through 12 ideas
- five Swiss rounds with half the selected field competing in each round
- one debate per idea per Swiss round and no repeated Swiss opponents
- wins, then Elo, two-way head-to-head when applicable, then seeded random order
- initial Elo 1500 and K-factor 32, with each round's rating changes applied
  simultaneously
- semifinal pairings 1-v-4 and 2-v-3, followed by one final
- no draws and `5 × selected ideas ÷ 2 + 3` total matches; the default 12-idea
  field produces 33 matches

Six is the minimum viable field because five Swiss rounds without rematches
require at least five distinct opponents, while an even field lets every idea
compete exactly once per round. Selection output below six, above 12, or with
an odd count fails the idea pipeline before any debate round is created.

Pairings and judge presentation slots are deterministic from the persisted
random seed. The first Swiss round uses a seeded shuffle. Later rounds rank the
field, then use deterministic score-ordered backtracking: the highest-ranked
unpaired idea tries its closest eligible opponent by win and Elo gap, the search
backtracks when a partial pairing dead-ends, and it accepts a complete pairing
only when the unused opponent graph still contains enough edge-disjoint perfect
matchings for every later Swiss round. The bounded 6–12 participant field and
memoized feasibility search make this deterministic without a scheduler or a
precomputed standings-blind bracket. The chosen complete round is locally
score-aware and future-feasible rather than guaranteed to be the globally
minimum-gap matching.

Presentation order is randomized. Rankings and prior matches never enter an
advocate or judge prompt. Every selected idea plays every Swiss round; a Swiss
loss does not eliminate it. Only a semifinal or final loss ends an idea's
knockout run.

Every match runs both openings concurrently, then both rebuttals concurrently,
then one structured judge verdict. All matches in the same round also run
concurrently at the orchestration layer; the shared process-wide LLM queue
bounds actual provider concurrency to four by default. Debates use each
selected idea's refined title and description.
Advocate prose disables hidden reasoning so its output budget is reserved for
the persisted opening or rebuttal rather than an invisible reasoning trace.
Every advocate receives the current matchup, shared original prompt and
briefing research, and only its assigned candidate's idea-specific research; it
does not receive its opponent's report. The judge receives both candidates'
idea-specific research plus the complete current transcript. Dynamic debate
context shares the configured aggregate character ceiling, retaining a bounded
entry for every required section rather than allowing candidate research and
transcripts to grow without limit.

Debate-owned LLM calls use the configured bounded SDK request policy: two
retries with exponential backoff by default. This handles retryable request
failures such as provider rate limits without adding an application retry service. Advocate
and judge stages add one narrower application-level retry only when a completed
provider stream is classified as a finish-reason failure with the AI SDK's
unified `other` reason. This bounded heuristic covers the observed Zen case
where an otherwise normal response ended prematurely with an unknown provider
reason. It does not retry `length`, `content-filter`, exhausted stream/request,
validation, or persistence failures.

Each application-level generation attempt remains a durable `llm_generations`
row; the SDK's transport retries occur inside that one generation. An advocate retry
compare-and-swap replaces the stable transcript message's generation link only
when it still points to the exact failed `other` attempt; concurrent or stale
replacement fails closed. Failed judge attempts remain unlinked, and only the
successful verdict transaction creates the judge message and match result.

## HTTP contract

Creation, history, and visibility changes require a Better Auth session.
Creation records the authenticated user on the debate and its atomic idea-job
parent; history includes the viewer's private debates and every public debate.
Debates are private by default.

Creation accepts the same `deepSearchCount`, `maxSearches`,
`maxResultsPerSearch`, and `maxRounds` controls as an idea job. Their defaults
remain `2`, `3`, `3`, and `3`; the shared root-workflow page-budget validation
applies before any row or provider call is created. Narrower values let
operators run a complete real-provider tournament smoke without a parallel
test-only workflow.

Detail and event reads allow either the owner or any viewer when the debate is
public. Public read access follows the aggregate into the debate-owned idea job,
its child deep searches, and every job-owned model stream. Private, revoked,
foreign, and unknown UUIDs return 404. Read responses never expose the owner's
user ID or identity.

### `POST /api/debate-jobs`

Starts idea generation and the automatic tournament. It returns `202 Accepted`:

```json
{
  "prompt": "Design a practical low-friction energy product",
  "isPublic": false,
  "numberOfIdeas": 12
}
```

`numberOfIdeas` configures how many candidates the idea stage generates. It is
an integer from 6 through 20 and defaults to 12. The selector may reject ideas,
but its admitted set must still satisfy the even 6-through-12 tournament
invariant. `isPublic` is optional and defaults to `false`.

```json
{ "debateJobId": "<uuid>", "slug": "low-friction-energy-products" }
```

The `Location` header points to `/api/debate-jobs/:slug`. Debate creation reuses
the generated title and slug stored by its owned idea job.

### `GET /api/debate-jobs`

Returns newest-first history as `{ "debateJobs": [...] }`. Each summary contains
`debateJobId`, `ideaJobId`, `title`, `slug`, `prompt`, `isPublic`, `stage`,
`status`, `error`, `createdAt`, and `completedAt`. The optional `limit` query
defaults to 100 and is capped at 200. The read scope includes owned private
debates and public debates.

### `GET /api/debate-jobs/:slug`

Returns `{ "debateJob": ... }`, containing the durable job state plus every
round, match, transcript message, current derived Swiss standings, and expected
match count. `expectedMatchCount` is null while idea selection is pending, then
is derived from the selected field size. Transcript messages link to
`/api/streams/:llmGenerationId` while live and contain terminal text after
persistence. The final match's winner is the tournament winner. Unknown slugs
return 404.

### `GET /api/debate-jobs/:debateJobId/events`

Returns replay-and-follow NDJSON. `updated` means clients should refresh the
durable snapshot. A failed job emits `error` with its exact message. Every
terminal stream ends with `done`. After restart, terminal events are synthesized
from SQLite.

### `PATCH /api/debate-jobs/:debateJobId`

The authenticated owner may update one or more mutable debate fields. The
currently supported field publishes a debate at any time and revokes it after
the debate reaches a terminal state:

```json
{ "isPublic": true }
```

It returns the debate's current mutable fields as `{ "isPublic": true }`.
Non-owners and unknown UUIDs receive 404. A running public debate cannot be made
private because already accepted anonymous NDJSON responses cannot be revoked;
that transition returns `409`. After completion, failure, or interruption,
revoking visibility makes new anonymous requests to the debate and every nested
resource return 404.

## Persistence and recovery

- `debate_jobs` owns one same-owner `idea_jobs` child and stores lifecycle,
  stage, deterministic random seed, and public visibility. The child carries
  the foreign key so deleting a debate cascades through its ideas, child
  searches, normalized research rows, tournament rows, and every job-owned LLM
  generation.
- The owned idea job also stores the debate's generated title and slug, avoiding
  a duplicate copy on `debate_jobs`.
- Tournament membership is derived from the owned idea job's durable selected
  flags. Rejected ideas remain inspectable but never appear in a match.
- `debate_rounds` and `debate_matches` store pairings and machine-readable
  winners. Round match counts derive from the selected field size.
- `debate_messages` links ordered transcript entries to durable, same-owner LLM
  generations; ownership is validated before each transcript link is written.
- A judge generation's terminal output, verdict-message link, winner, and match
  completion timestamp commit in one transaction. A failed completion hook
  rolls the generation terminal write back instead of leaving a half-linked
  verdict.
- Wins, Elo, standings, prior pairings, qualification, expected match count, and
  the winner projection are derived rather than duplicated.
- Round creation validates selected same-job membership, unique round
  appearances, dynamic stage match counts, prior-stage completion, and
  non-repeating Swiss opponents before inserting the complete round
  transactionally.
- The debate row is created first and its owned idea row is inserted in the same
  transaction before provider work starts, so a parent-row failure cannot leave
  an orphan idea run.

Provider work cannot resume after an API-process restart. Startup recovery marks
orphaned running debate jobs and generations interrupted while preserving
completed rounds, match results, and transcript text for replay. The exception
is a running job whose final verdict and winner already committed atomically:
recovery recognizes that completed final and closes the parent tournament as
completed.
