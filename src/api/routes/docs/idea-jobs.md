# Idea jobs

Idea jobs are durable pipelines that turn a user prompt into research-backed,
selected, refined, individually researched, and finally evaluated ideas. Each
run has an internal UUID, an LLM-generated
immutable title, a readable slug, and four durable stages: `planning`,
`research`, `summary`, and `ideas`. Comparative selection and final per-idea
evaluation are ordered subphases of `ideas`; each remains visible through
completion events and failure stages in the event contract.

Closing the page does not cancel the run. The owner may explicitly stop a
standalone root idea job; a debate-owned idea job inherits its debate root's
Stop signal and cannot be stopped directly. While a job is running,
another subscriber in the same API process replays the retained parent event
log and follows new events. Terminal runs evict that log and reconstruct their
events from normalized rows and persisted LLM output. A closed log is retained
when terminal persistence fails.

Failed or interrupted standalone roots can be resumed under the same job ID.
Debate-owned idea jobs are resumed only through their debate root. In either
case the coordinator loads the durable checkpoint graph, reuses completed
stages and child searches, and retries only incomplete work.

## Pipeline

1. One successful planning generation creates exactly `deepSearchCount` distinct,
   non-empty `{ title, prompt }` research plans.
2. One durable deep-search job is created immediately for each prompt. All
   child rows and links become visible together, while actual execution passes
   through the process-wide deep-search queue. A scoped position preserves
   prompt order for replay and briefing construction.
3. The parent waits for every launched child to settle. Durable child
   completion returns its committed final-answer text. Every idea-owned search
   persists strict summary quality: extraction failures remain acceptable
   snippet fallbacks, while a failed model-generated page summary fails the
   child and remains retryable from its persisted extracted content. If a child
   fails, the parent fails and no summary or idea generation starts.
4. One successful summary generation receives the original user prompt and only each
   child's final-answer text. Page records, source metadata, and intermediate
   output are not copied into this call. Hidden reasoning is disabled so the
   output budget is reserved for the durable research briefing.
5. One successful idea generation receives the original user prompt, the final
   research briefing, and `numberOfIdeas`. After the complete array passes
   validation, every `{ title, description }` is persisted and published in
   generation order with a stable ID and no evaluation link yet.
6. One successful structured selection generation receives the original user prompt,
   the final research briefing passed into idea generation, and every generated
   idea. Hidden selection reasoning is disabled so the bounded output is
   reserved for the required JSON. The output is an unordered array of unique
   idea IDs containing an even number of ideas from 6 through 12. Every ID must
   belong to this job.
   The selected ideas become `selected = true` and every other generated idea
   becomes `selected = false` in the same transaction as the selection
   generation's terminal output.
7. One successful structured refinement generation completes for each
   selected idea. It receives the original request, shared research briefing,
   and original idea. Its generation link is attached before publication;
   validated refined title and description commit together.
8. One deep-search job is then created for each refined idea. These
   searches reuse the request's existing `maxSearches`,
   `maxResultsPerSearch`, and `maxRounds`. Each search's parent-scoped position is
   `deepSearchCount + idea.position`. The parent waits for every selected-idea
   search to complete under the same strict summary policy.
9. One successful structured evaluation generation completes for each researched,
    refined idea. Each call receives the original request, shared research
    briefing, improved idea, and that idea's supporting-research answer. It
    returns two to four pros, two to four cons, and one concise critique of the
    final version. The calls run concurrently and attach their generation IDs
    to the selected ideas. Raw rejected candidates are not evaluated, so every
    displayed assessment describes the improved idea the user is reading.

The idea pipeline itself generates no websites. Standalone idea runs end after
evaluation; when a debate owns the idea job, that debate generates one website
for its tournament winner (see the debate contract).

Any planning, child-search, summary, idea-generation, selection-generation,
refinement-generation, selected-idea-search, or final-evaluation failure fails
the parent. An invalid selection count,
duplicate ID, or foreign ID is a selection failure. A final-evaluation failure
does not erase completed improvements or assessments. Selection remains null
when the selection transaction does not complete. Individual page-extraction
failures inside a child search are non-fatal when the search-result description
can be used as a fallback. A page-summary failure is fatal for the strict
idea-owned child even though the equivalent standalone search may accept its
snippet. Once concurrent work has started, the
parent waits for all of it to finish even if one operation fails, so it never
reports a terminal state while visible children or evaluation streams are still
running.

An explicit Stop ends the current execution. The manager persists the standalone idea
root's request before aborting queued or active work, and the signal propagates
to every initial or refined-idea child search. Every started concurrent fan-out
settles, including durable LLM and child-search cleanup, before the parent
becomes interrupted; no later stage or child may start after the effective root
is stopping. A user Stop and an inherited parent Stop are interruptions.
Provider deadlines and ordinary provider failures remain failures.

On first execution each successful stage has one durable output. On Resume,
completed planning, briefing, generation, selection, refinement, evaluation,
and child-search checkpoints are validated and reused. Failed, interrupted, or
stale-running generation attempts are retried only by atomically replacing the
exact owning link during registration; a newer link cannot be overwritten.
Existing child rows are resumed by their parent position instead of being
duplicated.

## HTTP contract

Creation and history require a Better Auth session. Creation records the
authenticated user as owner. Detail and event reads apply the idea-job read
scope: the owner may read a private job, while any viewer may read an idea job
belonging to a public debate. Anonymous viewers therefore receive inherited
public access; private, standalone foreign, and unknown UUIDs return 404. Public
responses omit the owner ID. Planning, summary, idea, evaluation, selection, and
child-search generations inherit the same owner.

### `POST /api/idea-jobs`

Starts a run and returns `202 Accepted`:

```json
{
  "prompt": "Generate practical products that help London renters reduce energy use",
  "numberOfIdeas": 8,
  "deepSearchCount": 2,
  "maxSearches": 3,
  "maxResultsPerSearch": 3,
  "maxRounds": 2
}
```

Only `prompt` is required. `numberOfIdeas` is an integer from 6 through 12 and
defaults to 8. The remaining numeric fields are positive integers with the
defaults shown above. The configured defaults cap `deepSearchCount` at 2,
`maxSearches` and `maxResultsPerSearch` at 5 each, `maxRounds` at 2, selected
URLs per child-search round at 15, and `prompt` at 10,000 characters. The same
deep-search limits apply to both initial briefing searches and refined-idea
searches; the manager validates generated child requests again before starting
provider work. The root request also accounts for all initial searches plus up
to 12 selected-idea searches against a 200-page aggregate worst-case selected
page budget by default. Invalid limit combinations fail before title generation
or job creation.

Creation returns `429` when the user already has the configured active root-job
limit (two by default). A running idea or debate pipeline consumes one root
slot; its child searches do not consume more slots and instead share the
process-wide deep-search execution queue. The slot is reserved before the
asynchronous title preflight so racing requests cannot both consume provider
work for one remaining slot. The rolling 24-hour quota permits at most two
standalone idea runs and five total root workflows per user by default. A
charged admission remains after a later title-preflight failure; rate rejections
include `Retry-After`.

The response is:

```json
{ "ideaJobId": "<uuid>", "slug": "london-renter-energy-products" }
```

The `Location` header points to `/api/idea-jobs/:slug`. Repeated generated titles
receive readable numeric suffixes.

### `GET /api/idea-jobs`

Returns the authenticated user's jobs newest-first as `{ "ideaJobs": [...] }`.
Public debate descendants remain readable through their detail and event routes
but do not appear in another user's history. Every item includes the derived
`stopRequested` flag. The optional `limit` query parameter defaults to 100 and
is capped at 200. Owner IDs are omitted.

### `GET /api/idea-jobs/:slug`

Returns the durable title, slug, prompt, internal ID, requested counts, current
stage, status, error, generation links, and timestamps as `{ "ideaJob": ... }`.
Detail responses add `isPublic`, which reports inherited public-debate
visibility, and `isIndexable`, which is true only when that debate is both
public and completed. Standalone and private owner-readable jobs report both
fields as false. These projections are detail-only and do not change the
history response. Detail also includes the derived `stopRequested` flag,
`canStop`, and `canResume`. `canStop` is true only for the authenticated owner
of a standalone root whose status is `running` and which has no persisted stop
request. It is false for debate-owned jobs, public viewers, terminal jobs, and
roots already stopping. `canResume` is true only for the owner of a failed or interrupted
standalone root; it is false for debate-owned jobs, completed roots, and
non-owners. Owners receive `feedback` in every lifecycle state with the current
nullable boolean `rating` and derived `hasWrittenFeedback`; this keeps owner
authority available when a snapshot fetched while running is later paired with
replay-derived completion. Anonymous and authenticated public non-owners receive
`feedback: null`. Written feedback is never returned. Unknown slugs return 404.
Completed owners also receive the derived nonnegative integer `creditsUsed`,
which sums the idea pipeline's settled LLM charges and every owned child
search's settled LLM, search-query, and page-extraction charges. It is `null`
unless the viewer owns a completed run. Standalone title generation is excluded
because it is not owned by the run.
On the completed owner detail page, the browser displays this total beside the
feedback thumbs.

### `POST /api/idea-jobs/:ideaJobId/cancel`

Requests a durable stop of an authenticated user's standalone root idea
job. The request timestamp commits before the manager aborts queued or active
work. If the running job has no live controller, such as after a process
restart, the route settles it durably as interrupted.

- A new or repeated request for a running root returns `202 Accepted` with
  `{ "status": "cancellation-requested", "cancelRequestedAt": "<timestamp>" }`.
- A root already interrupted by its direct Stop returns `200 OK` with
  `{ "status": "interrupted", "cancelRequestedAt": "<timestamp>",
  "completedAt": "<timestamp>" }`.
- An unknown or foreign job returns `404` without disclosing ownership.
- A debate-owned idea job or incompatible terminal state returns `409`.

The browser exposes this action only when detail `canStop` is true and requires
confirmation. After the request persists, history and detail show disabled
`Stopping…`, suppress active-work indicators, and retain completed output during
cleanup and after reload. Any job interrupted under an effective Stop request is
then labeled `Stopped`; an interruption without a Stop request remains
`Interrupted`. Debate-owned jobs and public or foreign viewers never receive the
control. Completed usage remains charged; stopped in-progress attempts do not
debit RethinkLoop credits. This application credit guarantee is not a claim
about how an upstream provider bills work it already received.

The Stop retains the workflow checkpoint. A later owner Resume—or the next API
startup reconciliation—can reopen the standalone root.

### `POST /api/idea-jobs/:ideaJobId/resume`

Reopens the authenticated owner's failed or interrupted standalone idea root
under the same ID. An already-running root is deduplicated against the live
manager entry. Both cases return `202 Accepted`:

```json
{ "status": "running" }
```

The reopen clears the root's error, completion timestamp, and direct Stop
timestamp, then recursively reconciles its child searches and pipeline
checkpoints. Unknown and foreign UUIDs return `404`. Debate-owned idea jobs and
completed roots return `409`; a debate-owned child can be resumed only through
its debate root. The owner UI shows `Resume workflow` only when `canResume` is
true, then refreshes the snapshot and reconnects the event feed under the same
URL and job ID.

### `PATCH /api/idea-jobs/:ideaJobId/feedback`

The authenticated owner may rate a completed standalone or debate-owned idea
job. Foreign and unknown UUIDs return `404`, and non-completed owner rows return
`409`. A rating may be changed or repeated:

```json
{ "type": "rating", "rating": false }
```

A positive rating atomically deletes any existing written feedback. A negative
rating preserves existing written feedback, and while the current rating is
negative the owner may add or replace a raw 5,000-character maximum,
non-whitespace-only explanation:

```json
{ "type": "text", "text": "The selected ideas were too similar." }
```

Text without a current negative rating returns `409`. Successful updates return
only the derived state and never echo the text:

```json
{ "feedback": { "rating": false, "hasWrittenFeedback": true } }
```

### `GET /api/idea-jobs/:ideaJobId/ideas/:ideaId/website`

Returns the stored single-file website generated for one selected idea of a
readable idea job — in practice the debate tournament winner — applying the same read scope as the detail and event routes:
the owner may read a private job, while any viewer may read a website belonging
to a public debate. The response is the generated HTML with
`Content-Type: text/html; charset=utf-8`, `Cache-Control: no-store`, and a
sandboxing `Content-Security-Policy` because the page is model output that must
not gain this origin's session credentials. Unknown or foreign jobs, ideas
outside the requested job, and ideas whose website was never generated return
404.

### `GET /api/idea-jobs/:ideaJobId/ideas/:ideaId/website/screenshot.png`

Returns the optional square PNG preview captured from the stored website of
one selected idea, applying exactly the same read scope as the website route:
the owner may read a private job, while any viewer may read a screenshot
belonging to a public debate. The response is `image/png` with
`Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Unknown or
foreign jobs, ideas outside the requested job, ideas whose website was never
generated, and ideas whose best-effort capture did not produce a file return
404.

### `GET /api/idea-jobs/:ideaJobId/events`

Returns the replay-and-follow NDJSON feed. Live jobs use the retained in-memory
event log; database-only jobs synthesize events from durable rows. Unknown UUIDs
return 404.

The event sequence is:

1. `research-prompt-stream` with the planning LLM stream ID.
2. `deep-search-started` once per child, with its job ID, title, slug, and
   research request.
3. `research-summary-stream` with the briefing LLM stream ID.
4. `idea-generation-stream` with the structured-output LLM stream ID.
5. `idea` once per validated object, including its stable `ideaId`.
6. `idea-selection-stream` with the structured selector LLM stream ID.
7. `selected-ideas` with the unordered `selectedIdeaIds` array after the
   selector output and every selected flag commit atomically.
8. `idea-refinement-stream` once per selected idea, keyed by stable `ideaId`.
9. `refined-idea` once per completed refinement, with its improved title and
    description.
10. `idea-deep-search-started` once per refined idea, with the stable `ideaId`,
    child job ID, title, slug, and generated research request.
11. `idea-evaluated` once per completed final evaluation, with the stable
    `ideaId`, ordered `pros`, ordered `cons`, and explanatory `critique`.
12. On ordinary failure, one `error` with the failing stage and message.
    Evaluation, selection, refinement, and selected-idea research use the event
    stages `evaluation`, `selection`, `refinement`, and `idea-research`; all
    remain durable subphases of the DB's `ideas` stage.
13. Exactly one terminal `done`.

A standalone root's explicit Stop or a debate-owned job's inherited Stop
publishes `stop-requested` after the effective root's durable timestamp commits.
Already-started result events may follow while cleanup settles, but no new
stage starts. Live and database-reconstructed feeds both end with exactly one
`interrupted`, then exactly one `done`, and do not publish an ordinary `error`
for either Stop. A reconnect while the effective root is settling replays
`stop-requested`; after terminal persistence it replays the same stop and
terminal suffix. Debate-owned jobs do not store an idea-level stop timestamp.
An interruption without a Stop remains distinct: it publishes `interrupted`, then `done`,
without `stop-requested`, and the browser renders it as `Interrupted`. Explicit
or inherited Stop renders as `Stopped`. Genuine failures retain the ordinary
`error`, then `done` sequence. If the idea job completed before its debate root
was later stopped, it remains completed and gains neither `stopRequested` nor a
Stop event suffix.

Each stream ID is read through `GET /api/streams/:id`, which exposes reasoning
and text progress independently from the parent feed. Deep-search progress is
not duplicated in the parent; clients link to or subscribe to each existing
`/api/deep-search-jobs/:id/events` feed.

`routes/ideas/run.ts` is the single Effect-owned idea coordinator. One
`runPromiseExit` bridge in the workflow runtime is its Promise-facing boundary.
It uses `Effect.gen` for stage ordering and concurrent `Effect.all` result-mode
fan-outs for initial child searches, refinements, selected-idea research, and
final evaluations. Every started item settles, while the first failure in input
order is reported deterministically. Hono, Drizzle commands, AI SDK policy, and
the existing process-wide queues remain outside Effect.

The coordinator does not subscribe to presentation streams. It awaits each
generation's durable completion handle and structured result directly, so a
validation failure or Stop cannot make the parent terminal while the same
generation still has unfinished durable cleanup.

## Persistence model

- `idea_jobs` owns the generated title, slug, request, requested counts,
  child-search limits, stage, lifecycle, timestamps, and four pipeline-level
  LLM generation links,
  including comparative selection, plus owner feedback. Feedback is nullable
  until completion; its text is valid only with a negative rating. A standalone
  root may also retain its `cancel_requested_at` Stop timestamp. Debate-owned
  idea jobs derive that state from the debate root and never copy its timestamp.
  The title and slug have no update route.
- A debate-created idea job points to its owning debate with `ON DELETE
  CASCADE`; standalone idea jobs leave that owner null. Deleting an idea job
  deletes its child searches and all generations owned by either level.
- Planning prompts, the research briefing, and raw structured idea, evaluation,
  and selection output live in linked `llm_generations` rows. Every started
  idea evaluation is linked from its idea. Replay validates the linked
  generation payload; it is not copied into another table or column.
- Each pipeline-level generation link is constrained to the exact idea job and
  user that own it. Evaluation links are unique foreign keys, and orchestration
  creates them only from evaluation calls owned by that same idea job. Evaluation
  and selection stay event subphases rather than adding durable DB stages.
  Retry registration compare-and-swaps the exact prior link and, when necessary,
  interrupts a stale-running attempt in the same transaction.
- `ideas` is the canonical representation of the validated idea set,
  with stable IDs and generation order. The complete batch is inserted before
  selection. The nullable selected flag then transitions once from pending to
  true or false when selection commits. Selected rows additionally own a one-time
  refinement generation link, refined title/description pair, and one final
  evaluation link. No extra refinement or join table is used.
- New jobs complete only after selection is terminal, every selected flag has
  resolved, and all selected ideas have completed refinement, attached deep
  research, and a terminal structured evaluation of the improved version.
- Child `deep_search_jobs` reference the parent with a matching owner and retain
  both their planning order and complete normalized research state. Initial
  research uses positions below `deepSearchCount`; selected-idea research uses
  `deepSearchCount + idea.position`. Replay and debate context derive that
  relationship; the idea does not store a redundant child-search ID.
- Idea cards, evaluations, and selected or rejected presentation replay from
  `ideas` and their linked generations.
- Idea websites are durable files, not rows: each completed page lives at
  `IDEA_SITES_DIR/<idea_uuid>/websites/index.html`. Right after the page is
  written, a headless Chromium renders that stored file and stores one square
  1024×1024 PNG preview beside it as `screenshot.png`. The capture is
  best-effort: it never blocks or fails the workflow, and a missing preview is
  reported by the debate snapshot's derived `winnerWebsiteHasScreenshot`
  projection instead of being assumed. Standalone idea runs store
  no website. A debate generates exactly one page for its tournament winner;
  the debate job links that generation through its nullable one-time
  `website_generation_id`, which feeds its completion guard; same-debate
  ownership is enforced transactionally by the workflow that writes both rows. CLI regeneration stores a standalone generation that
  cannot satisfy that composite key and therefore replaces only the website
  file, never the link.
- Every durable work-start and normal terminal transaction checks that the
  effective idea or debate root is still running without a Stop request. A
  completion race lost to cancellation becomes interruption rather than an
  ordinary failure. Interrupted generations preserve partial output, run their
  stage cleanup, and do not debit RethinkLoop credits.

On API startup, every non-completed standalone idea job is scheduled as an
effective root. Debate-owned idea jobs are reached only through their debate
coordinator. Reopening clears root terminal fields, then the idea runner reuses
completed generation and child-search checkpoints and retries incomplete work
from the children back to the parent. Completed child searches return their
durable final answers without new provider calls; incomplete children resume
under their existing IDs and persisted search controls. A synchronous reset or
scheduling error aborts server startup. The same reconciliation runs after an
owner-requested root Resume, while completed roots remain closed.
