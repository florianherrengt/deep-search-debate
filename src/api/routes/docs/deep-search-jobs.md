# Deep-search jobs

Deep-search jobs are durable SQLite records with stable UUID URLs. Live event deltas remain in memory, while structural progress is written to normalized typed tables at stage boundaries. There is no JSON snapshot or database event log.

Closing a browser tab does not stop a job. While it is running, reopening its URL in the same API process replays the exact retained live feed. Jobs with a durable terminal state evict that in-memory log and reconstruct reducer-compatible state from normalized rows and persisted LLM output. A closed log is retained when terminal persistence fails.

## HTTP contract

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
{ "deepSearchJobId": "<uuid>" }
```

The `Location` header points to `/api/deep-search-jobs/:deepSearchJobId`.

### `GET /api/deep-search-jobs`

Returns newest-first job history as `{ "deepSearchJobs": [...] }`. The optional `limit` query parameter defaults to 100 and is capped at 200.

### `GET /api/deep-search-jobs/:deepSearchJobId`

Returns durable request, limits, status, error, and timestamps as `{ "deepSearchJob": ... }`.

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

Idea pipelines also accept a completed child search when individual pages could not be extracted because a source was blocked, challenged, paywalled, unavailable, or unsupported. Those pages retain their search-snippet fallback. Query failures and model-generation failures remain fatal to the owning idea pipeline.

## Persistence model

- `deep_search_jobs` owns request, limits, lifecycle, timestamps, and the final-answer generation link.
- `deep_search_query_generations` links the job to the LLM invocation that generated queries.
- `deep_search_generated_queries` stores the complete ordered generated list.
- `deep_search_queries` represents only generated queries actually executed and links selection and synthesis generations.
- `deep_search_results` stores ordered web-search results and typed selection state.
- `deep_search_web_pages` deduplicates selected URLs within a job and links page-summary generation.
- `llm_generations` stores one terminal text/reasoning pair per invocation.

On API startup, orphaned running jobs, LLM generations, queries, and web pages are converted to typed interrupted or failed terminal states because external provider/search work cannot be resumed after a process restart.
