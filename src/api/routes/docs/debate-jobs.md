# Debate jobs

Debate jobs are durable automatic tournaments. A fresh user prompt first runs
the existing researched, selected, refined, individually researched, and
finally evaluated idea pipeline, then admits only its selected normalized ideas to
Swiss play and a top-four knockout. The
selection agent compares the generated candidates before refinement. Tournament
advocates and judges do not consume the final structured evaluations. Pros,
cons, critiques, and the selection output remain
available on the linked idea-job view.
The authenticated owner may explicitly stop the root debate; public viewers
cannot. The durable request propagates through its idea job, child searches,
advocates, and judges. Closing or reloading the page does not cancel work. Live
subscriptions replay retained events and terminal jobs rebuild their UI
snapshot from SQLite.

Failed or interrupted roots can be resumed under the same debate ID. The
tournament coordinator resumes its idea child first, then reuses completed
rounds, matches, transcript messages, verdicts, and website output while
retrying only incomplete checkpoints.

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
- no draws and `5 × selected ideas ÷ 2 + 3` total matches; the default API
  ceiling of 8 generated ideas permits at most 23 matches

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

## Effect orchestration and interruption

`routes/debates/run.ts` is the single Effect-owned tournament coordinator. One
`runPromiseExit` bridge is its Promise-facing runtime boundary. `Effect.gen`
sequences the idea pipeline, Swiss rounds, semifinals, final, and durable stage
transitions. Concurrent advocate pairs and all matches in one round use
`Effect.all` result mode with unbounded orchestration concurrency: every
launched item settles, while failure selection remains deterministic in input
order. The process-wide LLM queue remains the provider-concurrency authority
outside Effect.

Every durable stage, round, match, transcript message, generation attempt,
retry replacement, judge verdict, and normal terminal write checks that the
effective debate root is still running without a Stop request. A Stop that wins
a completion race becomes interruption rather than failure. It prevents new
rounds, messages, and provider attempts while retaining completed tournament
facts. Already-started work finishes durable interruption cleanup before the
parent becomes terminal. The debate-only `other` retry never treats workflow
interruption as retryable.

Stopping during the idea phase settles active child work descendant-first.
Stopping during the tournament aborts active advocates or judges and then
settles the debate. An interrupted in-progress generation preserves any partial
output and does not debit RethinkLoop credits. This application guarantee does
not promise that an upstream provider will waive its own charge. Descendant idea
or search jobs that completed before the debate's Stop timestamp remain
completed and do not acquire Stop presentation retroactively.
A later Resume clears the root Stop timestamp and reconciles the retained
checkpoint tree.

## HTTP contract

Creation, history, Stop, and visibility changes require a Better Auth session.
Creation records the authenticated user on the debate and its atomic idea-job
parent; history includes that user's debates. Debates are private by default.

Creation accepts the same `deepSearchCount`, `maxSearches`,
`maxResultsPerSearch`, and `maxRounds` controls as an idea job. Their debate
defaults are `1`, `2`, `2`, and `1`, with server ceilings of `1`, `3`, `3`, and
`1`. Debate-owned research can select at most 81 pages by default. Both this
debate-specific budget and the shared root-workflow page budget apply before any
row or provider call is created. Narrower values let
operators run a complete real-provider tournament smoke without a parallel
test-only workflow.

Detail and event reads allow either the owner or any viewer when the debate is
public. Public read access follows the aggregate into the debate-owned idea job,
its child deep searches, and every job-owned model stream. Private, revoked,
foreign, and unknown UUIDs return 404. Read responses never expose the owner's
user ID or identity.

### Public page metadata

In production, `GET /debates/:slug` serves the React application shell with
crawler-readable metadata. Public debates replace the generic document title,
description, canonical URL, Open Graph fields, and Twitter card fields with the
debate's generated title and prompt. The card reuses the branded PNG social
image. Private, revoked, unknown, and malformed slugs receive only the generic
site metadata, so the HTML response cannot disclose their title or prompt.

### `POST /api/debate-jobs`

Starts idea generation and the automatic tournament. It returns `202 Accepted`:

```json
{
  "prompt": "Design a practical low-friction energy product",
  "isPublic": false,
  "numberOfIdeas": 8
}
```

`numberOfIdeas` configures how many candidates the idea stage generates. It is
an integer from 6 through 8 and defaults to 8. The selector may reject ideas,
but its admitted set must still satisfy the even 6-through-12 tournament
invariant. `isPublic` is optional and defaults to `false`.

```json
{ "debateJobId": "<uuid>", "slug": "low-friction-energy-products" }
```

The `Location` header points to `/api/debate-jobs/:slug`. Debate creation reuses
the generated title and slug stored by its owned idea job.
Only authenticated users can create debates. A durable rolling 24-hour quota
permits one debate and five total root workflows per user by default; it is
charged before title generation and returns `429` with `Retry-After` when full.
Anonymous access remains read-only and is limited to public debate aggregates.

### `GET /api/debate-jobs`

Returns newest-first history as `{ "debateJobs": [...] }`. Each summary contains
`debateJobId`, `ideaJobId`, `title`, `slug`, `prompt`, `isPublic`, `stage`,
`status`, `stopRequested`, `error`, `createdAt`, and `completedAt`. The optional
`limit` query defaults to 100 and is capped at 200. The read scope includes the
authenticated user's debates.

### `GET /api/debate-jobs/:slug`

Returns `{ "debateJob": ... }`, containing the durable job state plus every
round, match, transcript message, current derived Swiss standings, and expected
match count. `expectedMatchCount` is null while idea selection is pending, then
is derived from the selected field size. Transcript messages link to
`/api/streams/:llmGenerationId` while live and contain terminal text after
persistence. The final match's winner is the tournament winner. Detail also
includes `isOwner`, `stopRequested`, `canStop`, and `canResume`. `canStop` is
true only for the owner while the root is running and has no persisted Stop
request; it is false for public viewers, terminal jobs, and roots already
stopping.
`canResume` is true only for the owner of a failed or interrupted root; it is
false for completed roots and non-owners. Unknown
slugs return 404. Owners receive `feedback` in every lifecycle state with the
current nullable boolean `rating` and derived `hasWrittenFeedback`; this keeps
owner authority available when a snapshot fetched while running is later paired
with replay-derived completion. Anonymous and authenticated public non-owners
receive `feedback: null`. Written feedback is never returned.
Completed owners also receive the derived nonnegative integer `creditsUsed`,
which sums settled tournament LLM charges and the complete debate-owned idea
and deep-search subtree. It is `null` unless the viewer owns a completed run.
Standalone title generation is excluded because it is not owned by the run.
On the completed owner detail page, the browser displays this total beside the
feedback thumbs.

### `POST /api/debate-jobs/:debateJobId/cancel`

Requests a durable Stop for the authenticated owner's root debate. The
manager commits `cancelRequestedAt` before publishing the request update and
aborting active work. If no live controller exists, the route settles the job
durably as interrupted.

- A new or repeated active request returns `202 Accepted` with
  `{ "status": "cancellation-requested", "cancelRequestedAt": "<timestamp>" }`.
- A debate already interrupted by its direct Stop returns `200 OK` with
  `{ "status": "interrupted", "cancelRequestedAt": "<timestamp>",
  "completedAt": "<timestamp>" }`.
- Unknown and foreign UUIDs return 404. Incompatible terminal jobs return 409.

The browser shows a confirmed Stop action only when detail `canStop` is true.
After the request persists, history, detail, and match views show disabled
`Stopping…`, suppress active-tournament indicators, and retain completed rounds,
messages, and match results during cleanup and after reload. A directly stopped
debate is then labeled `Stopped`; an interruption without a Stop request
remains `Interrupted`. Public and foreign viewers never receive the control.
Completed usage remains charged; stopped in-progress attempts do not debit
RethinkLoop credits. This application guarantee does not promise that an
upstream provider will waive its own charge.

The Stop retains the workflow checkpoint. A later owner Resume—or the next API
startup reconciliation—can reopen the debate.

### `POST /api/debate-jobs/:debateJobId/resume`

Reopens the authenticated owner's failed or interrupted debate under the same
ID. An already-running root is deduplicated against the live manager entry. Both
cases return `202 Accepted`:

```json
{ "status": "running" }
```

The reopen transaction clears the debate's error, completion timestamp, and
Stop timestamp before recursively resuming its idea and deep-search children.
Unknown and foreign UUIDs return `404`; completed debates return `409`. The
owner UI shows `Resume workflow` only when detail `canResume` is true, updates
the snapshot to running, and reconnects its snapshot-driven event subscription
without changing the URL or job ID.

### `PATCH /api/debate-jobs/:debateJobId/feedback`

The authenticated owner may rate a completed debate. Foreign and unknown UUIDs
return `404`, and non-completed owner rows return `409`. A rating may be changed
or repeated:

```json
{ "type": "rating", "rating": false }
```

A positive rating atomically deletes any existing written feedback. A negative
rating preserves existing written feedback, and while the current rating is
negative the owner may add or replace a raw 5,000-character maximum,
non-whitespace-only explanation:

```json
{ "type": "text", "text": "The final comparison missed the key trade-off." }
```

Text without a current negative rating returns `409`. Successful updates return
only the derived state and never echo the text:

```json
{ "feedback": { "rating": false, "hasWrittenFeedback": true } }
```

### `GET /api/debate-jobs/:debateJobId/events`

Returns replay-and-follow NDJSON. `updated` means clients should refresh the
durable snapshot. A Stop publishes `updated` after its durable request commits,
then another `updated` after interruption becomes terminal, followed by `done`.
It does not publish an ordinary `error`. A failed job still emits `error` with
its exact message before `done`. After restart, running and terminal events are
synthesized from SQLite, so refresh while stopping and terminal replay remain
snapshot-driven.

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
  stage, deterministic random seed, public visibility, and owner feedback.
  Feedback is nullable until completion; its text is valid only with a negative
  rating. The child carries the foreign key so deleting a debate cascades
  through its ideas, child searches, normalized research rows, tournament rows,
  and every job-owned LLM generation.
- The owned idea job also stores the debate's generated title and slug, avoiding
  a duplicate copy on `debate_jobs`.
- Tournament membership is derived from the owned idea job's durable selected
  flags. Rejected ideas remain inspectable but never appear in a match.
- `debate_rounds` and `debate_matches` store pairings and machine-readable
  winners. Round match counts derive from the selected field size.
- `debate_messages` links ordered transcript entries to durable, same-owner LLM
  generations; ownership is validated before each transcript link is written.
  A retry registration replaces only the exact failed, interrupted, or
  stale-running generation link and interrupts a stale-running attempt in that
  same transaction.
- A judge generation's terminal output, verdict-message link, winner, and match
  completion timestamp commit in one transaction. A failed completion hook
  rolls the generation terminal write back instead of leaving a half-linked
  verdict.
- Wins, Elo, standings, prior pairings, qualification, expected match count, and
  the winner projection are derived rather than duplicated.
- After the final verdict, the debate generates one self-contained website for
  the winning idea (`create-idea-site`, disabled hidden reasoning, generous
  65,536-token output budget),
  links it through `debate_jobs.website_generation_id`, stores it under
  `IDEA_SITES_DIR/<idea_uuid>/websites/index.html`, and only then completes. A
  website generation or file-write failure fails the whole debate. The square
  preview screenshot is written afterwards and is best-effort: a capture
  failure is logged and never fails the completed debate.
- Round creation validates selected same-job membership, unique round
  appearances, dynamic stage match counts, prior-stage completion, and
  non-repeating Swiss opponents before inserting the complete round
  transactionally.
- Root-aware compare-and-swap guards reject every new stage, round, match,
  message, retry, verdict, and terminal write after a Stop request. Losing a
  final-verdict completion race therefore interrupts the debate instead of
  overwriting the request with completion.
- The debate row is created first and its owned idea row is inserted in the same
  transaction before provider work starts, so a parent-row failure cannot leave
  an orphan idea run.

Provider connections cannot survive an API-process restart, but the workflow
resumes from durable application checkpoints. Startup schedules every
non-completed debate as an effective root before the HTTP listener opens; a
synchronous reset or scheduling failure aborts startup. The debate first resumes
its existing idea child, which in turn resumes incomplete deep searches. It then
reuses completed rounds, matches, advocate messages, judge verdicts, and the
deterministic bracket, retrying only an incomplete generation or match.

If the winner website generation completed before the process died, recovery
reuses its HTML and recreates a missing atomic file (and best-effort screenshot)
without another model call. Otherwise registration atomically replaces the
exact stale website-generation link. Completion still requires the final
verdict, the recursively completed research tree, a completed website
generation, and the stored site. The same checkpoint path runs after an
owner-requested Resume; completed debates are never reopened.
