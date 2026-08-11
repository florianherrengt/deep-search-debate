# Deep-search jobs

Deep-search jobs are durable SQLite records with an internal UUID plus an
LLM-generated immutable title and readable slug. Browser and detail URLs use the
slug; ownership, normalized relations, and event streams keep using the UUID.
Live event deltas remain in memory, while structural progress is written to
normalized typed tables at stage boundaries. There is no JSON snapshot or
database event log.

For a conceptual walkthrough of query generation, result selection, page
extraction, layered summarization, and final synthesis, see
[How deep search works](deep-search-pipeline.md).

Closing a browser tab does not stop a job. While it is running, reopening its URL in the same API process replays the exact retained live feed. Jobs with a durable terminal state evict that in-memory log and reconstruct reducer-compatible state from normalized rows and persisted LLM output. A closed log is retained when terminal persistence fails.

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
  "maxRounds": 3
}
```

```json
{ "deepSearchJobId": "<uuid>", "slug": "what-changed-in-the-market" }
```

The `Location` header points to `/api/deep-search-jobs/:slug`. If the generated
slug is already used by any search, creation appends `-2`, `-3`, and so on and
adds the same number to the displayed title because slugs are globally unique.

The request defaults to three searches, three explored results per search, and
three search rounds. Configured server ceilings default to 10 searches, 10
explored results per search, 3 rounds, 30 selected URLs per round, and 10,000
characters for `researchRequest`. The
product of the two search breadth limits cannot exceed the per-round
selected-URL ceiling. The same validation runs again in the job manager so
idea-generated and other internal child searches cannot bypass it. A job can
never execute more than `maxRounds`, even when the review model repeatedly asks
for more research. The complete root request also has a configured worst-case
selected-page budget (400 by default).

Standalone creation returns `429` when the user already has the configured
number of active root research workflows (two by default, counting standalone
deep searches, standalone idea jobs, and running debate jobs). A debate keeps
its slot after its owned idea pipeline finishes and until the tournament is
terminal. Child searches do not
consume additional root slots. All root and child deep-search pipelines pass
through one process-wide queue with concurrency two by default; creation still
returns immediately after durable job insertion while queued work waits. Root
capacity is reserved before title generation, so concurrent requests cannot
spend duplicate preflight calls for one slot. A newly admitted root runs before
children still waiting from an earlier eager batch; active work is not
pre-empted.

### `GET /api/deep-search-jobs`

Returns newest-first standalone job history as `{ "deepSearchJobs": [...] }`.
The read scope is applied before the standalone filter; because standalone jobs
have no public-debate ancestor, this collection contains the viewer's own jobs.
The optional `limit` query parameter defaults to 100 and is capped at 200. Owner
IDs are omitted.

### `GET /api/deep-search-jobs/:slug`

Returns durable title, slug, request, internal ID, limits, status, error, and
timestamps as `{ "deepSearchJob": ... }`.

### `GET /api/deep-search-jobs/:deepSearchJobId/events`

Returns the replay-and-follow NDJSON feed. Live jobs use the retained in-memory event log. Database-only jobs synthesize events from normalized records. Unknown UUIDs return 404.

Each non-empty completed search round emits:

1. `query-stream` and `search-results`, both keyed by zero-based `round`.
2. `selection-stream` and `selected-search-results` per executed query, keyed
   by `round` and query.
3. `page-summary-stream` or `page-summary-error` per unique selected URL. Page
   work is job-wide and a URL is never extracted twice across rounds.
4. `query-summary-stream` per executed query, keyed by `round` and query.
5. Unless the hard round limit has been reached, `round-review-stream` followed
   by either `round-review` (`continue` or `stop`) or `round-review-error`.

`continue` starts the next numbered round. `stop`, review failure, an empty new
query list, or the hard round limit ends exploration. The terminal sequence is:

1. `final-answer-stream` after every accumulated query summary completes.
2. Optional job-level `error`, then `done`.

The final-answer agent receives the original research request and a bounded
in-memory projection of every completed query-level summary from every round.
Full summaries remain durable; when their combined prompt representation would
exceed the configured character budget, each keeps an equal serialized slot
with middle omission markers. The same projection feeds next-round planning and
round review, and executed queries are not serialized a second time outside
their labeled summaries. The final generation's terminal
transaction verifies every planned query has a completed row, verifies the
final generation's persisted text, and marks the job
completed. Page-summary failures stay attached to their web-page row and fall
back to search snippets; a query-summary, final-answer, or wider pipeline
failure marks the job failed.

Internally, model-backed stages return their stream ID, durable completion, and
typed result separately. Deep-search orchestration awaits those handles rather
than subscribing to `/api/streams`; the public stream remains solely a live and
replayable presentation interface. Page, query, and final job completion commit
inside the same transaction as the corresponding generation outcome. The
runner therefore does not scan linked generations or reread the final answer;
it returns the text whose completion transaction already committed.

`routes/deepSearch/pipeline.ts` is the single workflow coordinator: it owns the
bounded round loop, stage ordering, fallback decisions, URL deduplication, and
public event sequence. It calls stable-ID store commands before publishing each
event. Modules under `agents/deep_search` only format prompts, start model or
extraction operations, validate their output, and return handles or typed
outcomes. They do not publish job events or mutate deep-search tables. `run.ts`
surrounds the pipeline with failure persistence and the terminal public event
sequence. Its promise resolves with the persisted final text or rejects with
the error stored by the failure transaction.

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
| Query summary | Query and job fail; final-answer generation does not start | Parent fails |
| Round review | Exploration stops and final synthesis uses the evidence already collected | Parent accepts the completed child |
| Final answer | Job fails | Parent fails |
| Terminal database persistence | The live feed emits `error` then `done` and remains retained; restart recovery later interrupts any still-running durable row | Parent fails |

An empty validated query list is not a failure. In the first round it skips all
retrieval work and asks the final-answer agent to answer from an empty summary
list. In a later round it ends exploration and synthesizes the evidence from
earlier rounds. Empty rounds publish and replay their `query-stream`, but do not
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
  limit, lifecycle, timestamps, the final-answer generation link, and an
  optional parent-scoped position for idea-pipeline searches.
- The same row owns the generated title and slug used for history and browser
  navigation. They have no update route.
- `deep_search_rounds` stores one ordered round, links its query-plan
  generation, and stores its optional review generation and terminal
  continuation decision.
- `deep_search_queries` stores each ordered planned query before web search and
  carries that same stable ID through search, selection, and synthesis.
- `deep_search_results` stores ordered web-search results. A non-null page link
  is the selected-result fact; rejected and pending presentation state is
  rebuilt from that link and the owning query lifecycle. Selection-generation
  attachment and result-link commit are one-shot compare-and-swap transitions,
  so a retry cannot rewrite replay history or orphan an earlier selected page.
- `deep_search_web_pages` deduplicates selected URLs within a job and links page-summary generation.
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
relationship transactionally. Final-generation completion and successful job
completion are one transaction. Fatal cleanup marks every nonterminal query and
page plus the job failed using one root error and one completion timestamp in a
separate transaction.

On API startup, orphaned running jobs, LLM generations, round reviews, queries,
and web pages are converted to typed interrupted or failed terminal states
because external provider/search work cannot be resumed after a process
restart.
