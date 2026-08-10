# Deep-search jobs

Deep-search jobs are durable SQLite records with an internal UUID plus an
LLM-generated immutable title and readable slug. Browser and detail URLs use the
slug; ownership, normalized relations, and event streams keep using the UUID.
Live event deltas remain in memory, while structural progress is written to
normalized typed tables at stage boundaries. There is no JSON snapshot or
database event log.

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
  "maxResultsPerSearch": 3
}
```

```json
{ "deepSearchJobId": "<uuid>", "slug": "what-changed-in-the-market" }
```

The `Location` header points to `/api/deep-search-jobs/:slug`. If the generated
slug is already used by that user, creation appends `-2`, `-3`, and so on and
adds the same number to the displayed title.

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

The progress event sequence remains:

1. `query-stream`
2. `search-results`
3. `selection-stream` and `selected-search-results` per executed query
4. `page-summary-stream` or `page-summary-error` per unique selected URL
5. `query-summary-stream` per executed query
6. `final-answer-stream` after every query summary completes
7. optional job-level `error`, then `done`

The final-answer agent receives the original research request and every completed query-level summary. The job is marked complete only after its final-answer generation and every other linked LLM generation have persisted terminal text and reasoning. Page-summary failures stay attached to their web-page row and fall back to search snippets; a query-summary, final-answer, or wider pipeline failure marks the job failed.

SearXNG results without a non-empty snippet are omitted at the provider
boundary because they cannot support that fallback. Malformed result titles or
URLs still fail provider validation instead of being silently discarded.

A deep-search job may belong to an idea job. Initial briefing searches occupy
parent positions below `deepSearchCount`. After selection and refinement, each
selected idea starts another child at `deepSearchCount + idea.position`, links
that job from its `ideas` row, and reuses the initial request's search breadth
settings. It keeps the same extraction and failure semantics when used as a
child: blocked, challenged, paywalled, unavailable, or unsupported pages retain
their search-snippet fallback, while query and model-generation failures remain
fatal. See [the idea-job contract](idea-jobs.md) for parent-pipeline behavior.

## Persistence model

- `deep_search_jobs` owns request, limits, lifecycle, timestamps, the final-answer generation link, and an optional parent-scoped position for idea-pipeline searches.
- The same row owns the generated title and slug used for history and browser
  navigation. They have no update route.
- `deep_search_query_generations` links the job to the LLM invocation that generated queries.
- `deep_search_generated_queries` stores the complete ordered generated list.
- `deep_search_queries` represents only generated queries actually executed and links selection and synthesis generations.
- `deep_search_results` stores ordered web-search results and typed selection state.
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
terminal timestamp/error fields cannot be mixed.

On API startup, orphaned running jobs, LLM generations, queries, and web pages are converted to typed interrupted or failed terminal states because external provider/search work cannot be resumed after a process restart.
