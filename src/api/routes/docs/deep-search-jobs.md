# Deep-search jobs

Deep-search jobs are durable SQLite records with an internal UUID plus an
LLM-generated immutable title and readable slug. Browser and detail URLs use the
slug; ownership, normalized relations, and event streams keep using the UUID.
Live event deltas remain in memory, while structural progress is written to
normalized typed tables at stage boundaries. There is no JSON snapshot or
database event log.

For a conceptual walkthrough of query generation, result selection, page
extraction, layered summarization, candidate review, and answer promotion, see
[How deep search works](deep-search-pipeline.md).

Closing a browser tab does not stop a job. An owner may explicitly stop a
standalone root search; child searches inherit cancellation from their owning
idea or debate and cannot be stopped directly. While a job is running,
reopening its URL in the same API process replays the exact retained live feed.
Jobs with a durable terminal state evict that in-memory log and reconstruct
reducer-compatible state from normalized rows and persisted LLM output. A
closed log is retained when terminal persistence fails.

## HTTP contract

Creation and history require a Better Auth session. Creation records the
authenticated user as owner. Detail and event reads apply the deep-search read
scope: the owner may read a private job, while any viewer may read a child search
whose idea job belongs to a public debate. Anonymous viewers therefore receive
inherited public access; private, standalone foreign, and unknown UUIDs return
404. Public responses omit the owner ID. Child jobs created by an idea pipeline
inherit the same owner.

### `POST /api/deep-search-jobs`

Starts a job and returns `202 Accepted`:

```json
{
  "researchRequest": "What changed in the market?",
  "maxSearches": 3,
  "maxResultsPerSearch": 3,
  "maxRounds": 2
}
```

```json
{ "deepSearchJobId": "<uuid>", "slug": "what-changed-in-the-market" }
```

The `Location` header points to `/api/deep-search-jobs/:slug`. If the generated
slug is already used by any search, creation appends `-2`, `-3`, and so on and
adds the same number to the displayed title because slugs are globally unique.

The request defaults to three searches, three explored results per search, and
two search rounds. Configured server ceilings default to 5 searches, 5
explored results per search, 2 rounds, 15 selected URLs per round, and 10,000
characters for `researchRequest`. The
product of the two search breadth limits cannot exceed the per-round
selected-URL ceiling. The same validation runs again in the job manager so
idea-generated and other internal child searches cannot bypass it. A job can
never execute more than `maxRounds`, even when the review model repeatedly asks
for more research. The complete root request also has a configured worst-case
selected-page budget (200 by default). A standalone search can therefore select
at most 30 pages under the default server configuration.

Standalone creation returns `429` when the user already has the configured
number of active root research workflows (two by default, counting standalone
deep searches, standalone idea jobs, and running debate jobs). A debate keeps
its slot after its owned idea pipeline finishes and until the tournament is
terminal. Child searches do not
consume additional root slots. All root and child deep-search pipelines pass
through one process-wide queue with concurrency two by default; creation still
returns immediately after durable job insertion while queued work waits. Root
capacity is reserved before title generation, so concurrent requests cannot
spend duplicate preflight calls for one slot. The durable 24-hour creation quota
also permits at most four standalone searches and five total root workflows per
user by default. Admission is charged before title generation, including when
that preflight later fails; quota rejections return `Retry-After`. A newly admitted root runs before
children still waiting from an earlier eager batch; active work is not
pre-empted.

### `GET /api/deep-search-jobs?source=manual|automated`

Returns newest-first job history as `{ "deepSearchJobs": [...] }`. The `source`
query parameter splits the history into searches started manually by the user
(`manual`) and searches started by the system (`automated`) as child searches of
the idea pipeline. History is owner-only and applies the source filter after
ownership. Public debate descendants remain readable through their detail and
event routes but do not appear in another user's history. The optional `limit`
query parameter defaults to 100 and is capped at 200. Owner IDs are omitted.

Automated items carry an `origin` object: `{ "kind": "idea", ... }` when the
owning idea job is standalone, or `{ "kind": "debate", ... }` when that idea job
belongs to a debate. A debate has no title of its own, so both kinds report the
owning idea job's title and slug, which address the debate route for
debate-owned searches. Manual items carry `"origin": null`.

Every history item includes `stopRequested`. Standalone roots derive it from
their own persisted stop timestamp; automated children derive it from the
effective idea or debate root without storing a duplicate timestamp. The
derived flag is true only while the child is running or when it was interrupted
at or after that root request. A child completed before a later ancestor Stop
keeps `stopRequested: false` and its completed presentation.

### `GET /api/deep-search-jobs/:slug`

Returns durable title, slug, request, internal ID, limits, status, error, and
timestamps as `{ "deepSearchJob": ... }`. The detail projection also includes
`isPublic` for inherited public-debate visibility and `isIndexable`, which is
true only when the owning debate is both public and completed. Standalone and
private owner-readable jobs report both fields as false. These fields are not
part of the standalone history response. Detail also includes the derived
`stopRequested` flag and `canStop`. `canStop` is true only for the authenticated
owner of a standalone root whose status is `running` and which has no persisted
stop request. It is false for children, public viewers, terminal jobs, and roots
already stopping. Owners receive `feedback` in every lifecycle state with the
current nullable boolean `rating` and derived `hasWrittenFeedback`; this keeps
owner authority available when a snapshot fetched while running is later paired
with replay-derived completion. Anonymous and authenticated public non-owners
receive `feedback: null`. Written feedback is never returned.
Completed owners also receive the derived nonnegative integer `creditsUsed`,
which sums settled LLM, search-query, and page-extraction charges owned by this
run. It is `null` unless the viewer owns a completed run. Standalone title
generation is excluded because it is not owned by the run.
On the completed owner detail page, the browser displays this total beside the
feedback thumbs.

### `POST /api/deep-search-jobs/:deepSearchJobId/cancel`

Requests the irreversible stop of an authenticated user's standalone root
search. The request is persisted before the manager aborts queued or active
work. It is valid for the active job to have no live controller—for example,
after a process restart—in which case the route settles it durably as
interrupted.

- A new or repeated request for a running root returns `202 Accepted` with
  `{ "status": "cancellation-requested", "cancelRequestedAt": "<timestamp>" }`.
- A root already interrupted by that direct request returns `200 OK` with
  `{ "status": "interrupted", "cancelRequestedAt": "<timestamp>",
  "completedAt": "<timestamp>" }`.
- An unknown or foreign job returns `404` without disclosing ownership.
- A child search or incompatible terminal state returns `409`.

The browser exposes this action only when detail `canStop` is true and requires
confirmation. After the request persists, history and detail show disabled
`Stopping…`, suppress active-work indicators, and retain completed output during
cleanup and after reload. Any job interrupted under an effective Stop request is
then labeled `Stopped`; a restart interruption without a Stop request remains
`Interrupted`. Children and public or foreign viewers never receive the control.
Completed usage remains charged; stopped in-progress attempts do not debit
RethinkLoop credits. This is an application credit guarantee, not a claim about
how an upstream provider bills work it already received.

### `PATCH /api/deep-search-jobs/:deepSearchJobId/feedback`

The authenticated owner may rate any completed search, including an automated
idea child. Foreign and unknown UUIDs return `404`, and non-completed owner rows
return `409`. A rating may be changed or repeated:

```json
{ "type": "rating", "rating": false }
```

A positive rating atomically deletes any existing written feedback. A negative
rating preserves existing written feedback, and while the current rating is
negative the owner may add or replace a raw 5,000-character maximum,
non-whitespace-only explanation:

```json
{ "type": "text", "text": "The sources did not answer the core question." }
```

Text without a current negative rating returns `409`. Successful updates return
only the derived state and never echo the text:

```json
{ "feedback": { "rating": false, "hasWrittenFeedback": true } }
```

### `GET /api/deep-search-jobs/:deepSearchJobId/events`

Returns the replay-and-follow NDJSON feed. Live jobs use the retained in-memory event log. Database-only jobs synthesize events from normalized records. Unknown UUIDs return 404.

Each non-empty completed search round emits:

1. `query-stream` and `search-results`, both keyed by zero-based `round`.
2. `selection-stream` and `selected-search-results` per executed query, keyed
   by `round` and query.
3. `page-summary-stream` or `page-summary-error` per unique selected URL. Page
   work is job-wide and a URL is never extracted twice across rounds.
4. `query-summary-stream` per executed query, keyed by `round` and query.
5. `round-answer-stream`, keyed by `round`, for the candidate synthesized from
   every query summary accumulated so far.
6. Unless the hard round limit has been reached, `round-review-stream` followed
   by either `round-review` (`continue` or `stop`) or `round-review-error`.

`continue` starts the next numbered round using the previous candidate and
review reason as additional planning context. `stop`, review failure, or the
hard round limit promotes the current candidate. Normal completion publishes
`final-answer-stream`, referencing the same stream ID as the promoted
`round-answer-stream`, then `research-analysis`, followed by `done`. The typed
analysis payload contains `facts`, `disagreements`, `gaps`, and `assumptions`;
all but gaps carry source URL arrays. Ordinary failure publishes `error`, then
`done`; it may already have published a final-answer stream if terminal
persistence was the failing boundary. A durable restart interruption publishes
`interrupted`, then `done`, without `stop-requested`.

A standalone root's explicit Stop or an active child's inherited idea/debate
Stop publishes `stop-requested` after the effective root's durable timestamp commits.
The child does not copy that timestamp. Already-started result events may follow
while cleanup settles, but no new stage may start. Live and
database-reconstructed feeds both end with exactly one `interrupted`, then
exactly one `done`, and do not publish an ordinary `error` for either Stop. A
reconnect while the effective root is still settling replays `stop-requested`;
after terminal persistence it replays the same stop and terminal suffix.
Restart interruption remains distinct: it has no stop timestamp, publishes no
`stop-requested`, and the browser renders it as `Interrupted`; explicit or
inherited Stop renders as `Stopped`. A child that completed before the root
request keeps its normal completed replay without either Stop event.

Each candidate-answer call receives the original research request and a bounded
in-memory projection of every completed query-level summary from every round.
Full summaries remain durable; when their combined prompt representation would
exceed the configured character budget, each keeps an equal serialized slot
with middle omission markers. The same projection feeds next-round planning and
round review, and executed queries are not serialized a second time outside
their labeled summaries. The accepted candidate and those summaries feed a
separate structured research-analysis generation. Promotion verifies every
planned query has a completed row, verifies the candidate generation's
persisted text and the schema-valid analysis, attaches the candidate as the
job's final answer, and marks the job completed in one transaction.
Page-summary failures stay attached to their web-page row and fall back to
search snippets; a query-summary, candidate-answer, research-analysis, or wider
pipeline failure marks the job failed.

Internally, model-backed stages return their stream ID, durable completion, and
typed result separately. Deep-search orchestration awaits those handles rather
than subscribing to `/api/streams`; the public stream remains solely a live and
replayable presentation interface. Page and query completion commit inside the
same transaction as the corresponding generation outcome. A candidate answer
becomes durable before review; after acceptance, the separate structured
analysis becomes durable. A later transaction verifies both generations,
promotes the already completed candidate, and marks the job completed. The
runner returns the same candidate text without a second answer call or copied
output.

`routes/deepSearch/pipeline.ts` is the single Effect-owned workflow coordinator:
it owns the bounded round loop, stage ordering, fallback decisions, URL
deduplication, and public event sequence. One `runPromiseExit` bridge in the
workflow runtime is its Promise-facing boundary. The coordinator uses
`Effect.gen` for sequencing and concurrent `Effect.all` result-mode fan-outs to
settle all started work while retaining deterministic input-order failure
selection. Hono, Drizzle commands, AI SDK policy, and the existing process-wide
queues remain outside Effect.

The coordinator calls stable-ID store commands before publishing each event.
Modules under `agents/deep_search` only format prompts, start model or extraction
operations, validate their output, and return handles or typed outcomes. They
do not publish job events or mutate deep-search tables. `run.ts` surrounds the
pipeline with failure or interruption persistence and the terminal public event
sequence. Its promise resolves with the persisted final text or rejects with
the error stored by the terminal transaction.

Each round starts its server-bounded web-search batch concurrently, then settles
every started request before either persisting results or exposing a fatal
failure. If multiple searches fail, query order determines the reported error,
not response timing. Source selection remains sequential and every selection
must succeed before page work starts. Started page and query-summary work is
also settled before a pipeline failure reaches the job runner, so no generation
callback can write after the job becomes terminal. Selected-page
extraction-plus-summary work passes through a process-wide queue (four tasks by
default), and its ScrapingAnt requests continue through the provider's stricter
single-request queue.

The failure policy is:

| Boundary | Durable search outcome | Owning idea-pipeline outcome |
| --- | --- | --- |
| Query generation | Job fails; no search starts | Parent fails |
| Web search | Job fails; selection does not start | Parent fails |
| Result selection | Query and job fail; extraction does not start | Parent fails |
| Page extraction | Page fails at `extraction`; the query uses its search snippet | Parent accepts the completed child |
| Page-summary registration or generation | Page fails at `summary`; the query uses its search snippet and the standalone job may complete | Parent rejects the child through its stricter model-generation quality gate |
| Query summary | Query and job fail; candidate-answer generation does not start | Parent fails |
| Candidate answer | Job fails | Parent fails |
| Structured research analysis | Job fails; candidate is not promoted | Parent fails |
| Round review | Exploration stops and the current candidate is promoted | Parent accepts the completed child |
| Terminal database persistence | The live feed emits `error` then `done` and remains retained; restart recovery later interrupts any still-running durable row | Parent fails |

An empty validated query list is not a failure. It skips retrieval work for
that round and asks the candidate-answer agent to answer from the accumulated
summary list, which may be empty in round one. Empty rounds publish and replay
their `query-stream`, but do not
fabricate an empty `search-results` event because no web-search batch completed.

Search-provider rows without a non-empty title, snippet, or public extractable
HTTPS URL are omitted at the provider boundary because they cannot support the
fallback or extraction policy. Accepted URLs are canonicalized and deduplicated
per query while preserving the provider's first ranking. Per-field, result-count,
and response-byte limits prevent a provider response from becoming an unbounded
prompt or allocation.

A successful provider response with no usable rows completes that query without
starting selection, extraction, or query-summary generations. The pipeline adds
a deterministic no-results note to the in-memory round evidence and can let the
bounded round reviewer try a revised query. The durable completed query has no
selection or summary generation links, so replay exposes the empty search and
empty selected-result set without inventing model work.

A deep-search job may belong to an idea job. Initial briefing searches occupy
parent positions below `deepSearchCount`. After selection and refinement, each
selected idea starts another child at `deepSearchCount + idea.position` and
reuses the initial request's search breadth
settings. It keeps the same extraction and failure semantics when used as a
child: blocked, challenged, paywalled, unavailable, or unsupported pages retain
their search-snippet fallback, while query and model-generation failures remain
fatal. See [the idea-job contract](idea-jobs.md) for parent-pipeline behavior.

## Persistence model

Structural mutations are owned by the plain commands in
`routes/deepSearch/store.ts`. Commands accept stable job, round, query, result,
page, and generation IDs; assert that linked records belong to the job; wrap
multi-row changes in SQLite transactions; and return newly allocated IDs needed
by later stages as `SearchRound`, `PlannedQuery`, `ExecutedQuery`,
`SearchResultRecord`, and `SelectedPage` records from `records.ts`. They do not
accept job events. The pipeline carries returned records into later stages for
planned-query, selection, page, summary, and review persistence instead of
rediscovering rows by query string, URL, or position. There is no
event-to-persistence adapter: events are published only after their owning store
command commits. Job lifecycle writes remain in `jobLifecycle.ts`.

- `deep_search_jobs` owns request, per-round breadth limits, the hard round
  limit, lifecycle, timestamps, the final-answer and structured
  research-analysis generation links, owner feedback, and an optional
  parent-scoped position for idea-pipeline searches. Feedback is nullable until
  completion; its text is valid only with a negative rating.
- The same row owns the generated title and slug used for history and browser
  navigation. They have no update route.
- `deep_search_rounds` stores one ordered round, links its query-plan and
  candidate-answer generations, and stores its optional review generation and
  terminal continuation decision.
- `deep_search_queries` stores each ordered planned query before web search and
  carries that same stable ID through search, selection, and synthesis. Its
  `credits_used` is set only after the search provider returns successfully.
- `deep_search_results` stores ordered web-search results. A non-null
  `selected_web_page_id` is the selected-result fact and links to the job-wide
  deduplicated page; rejected and pending presentation state is rebuilt from
  that link and the owning query lifecycle. Selection-generation
  attachment and result-link commit are one-shot compare-and-swap transitions,
  so a retry cannot rewrite replay history or orphan an earlier selected page.
- `deep_search_web_pages` deduplicates selected URLs within a job, links its
  page-summary generation, and records the product-credit cost of every reported
  ScrapingAnt attempt for that URL, including unsuccessful attempts.
- `llm_generations` stores one terminal text/reasoning pair per invocation.

Every workflow generation points back to the deep-search job that created it.
Deleting the job cascades through its normalized query/page/result rows and all
of those generations. Generation-use and selected-result page links use `NO
ACTION`, which blocks partial leaf deletion but allows the complete job cascade
to remove both sides in one statement.

Root generation and idea-parent links use composite foreign keys containing the
exact job and user owner. Nested query and page generation links validate the
exact deep-search job owner before the relationship is written. SQLite triggers
also require every selected result page to belong to the same deep-search job as
the result's query.

Lifecycle checks require completed jobs to have a final-answer generation,
completed queries to have selection and summary generations, completed pages to
have a summary generation, and selected results to have a page. Active and
terminal timestamp/error fields cannot be mixed. Page-summary and query-summary
generation registration, success, and failure update both sides of each
relationship transactionally. The current pipeline also requires the research
analysis generation before promotion; the link is nullable while a running job
has not started or completed that generation. Candidate promotion and
successful job completion are one transaction after the answer and structured
analysis generations complete. Every durable
work-start transaction, plus normal success, failure, and credit transitions,
asserts that the effective root is still running and has no stop request. A
completion race lost to cancellation becomes interruption rather than ordinary
failure. Stop cleanup is allowed to settle every nonterminal query and page
before marking the job interrupted; an interrupted model attempt persists its
partial output, runs its stage cleanup, and does not debit RethinkLoop credits.
Fatal cleanup uses the existing failed query/page states and marks every
nonterminal record plus the job failed with one root error and completion
timestamp.

On API startup, orphaned running jobs, LLM generations, round reviews, queries,
and web pages are converted to typed interrupted or failed terminal states
because external provider/search work cannot be resumed after a process
restart.
