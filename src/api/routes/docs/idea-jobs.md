# Idea jobs

Idea jobs are durable pipelines that turn a user prompt into research-backed, critiqued ideas. Each run has a stable UUID and five stages: `planning`, `research`, `summary`, `ideas`, and `critique`.

Closing the page does not cancel the run. While it is running, another subscriber in the same API process replays the retained parent event log and follows new events. Terminal runs evict that log and reconstruct their events from normalized rows and persisted LLM output. A closed log is retained when terminal persistence fails.

## Pipeline

1. One fresh planning generation creates exactly `deepSearchCount` distinct, non-empty research prompts.
2. One durable deep-search job starts immediately for each prompt. All child jobs run in parallel, while a scoped position preserves prompt order for replay and briefing construction.
3. The parent waits for every launched child to settle. If any child fails, the parent fails and no summary or idea generation starts.
4. One fresh summary generation receives the original user prompt and only each child's final-answer text. Page records, source metadata, and intermediate output are not copied into this call.
5. One fresh idea generation receives the original user prompt, the research briefing, and `numberOfIdeas`. After the complete array passes validation, every `{ title, description }` is persisted and published in generation order with no critique link yet.
6. One fresh critique generation starts for each persisted idea. Each call receives only the original user prompt, research briefing, and that one idea. The calls run concurrently. As each call starts, its generation ID is attached to that idea before the stream event is published; free-form reasoning and critique use the normal LLM generation stream. The parent waits for every critique to settle before completing.

Any planning, child-search, summary, idea-generation, or critique-generation failure fails the parent. A critique failure does not erase the already-valid ideas; an idea whose critique never started retains a null critique link. Individual page-extraction failures inside a child search are non-fatal when the search result description can be used as a fallback. Once concurrent work has started, the parent waits for all of it to finish even if one operation fails so it never reports a terminal state while visible children or critique streams are still running.

## HTTP contract

Every endpoint requires a Better Auth session. Creation records the authenticated
user as owner; history includes only that user's jobs, and foreign detail/event
UUIDs return 404. Planning, summary, idea, critique, and child-search generations
inherit the same owner.

### `POST /api/idea-jobs`

Starts a run and returns `202 Accepted`:

```json
{
  "prompt": "Generate practical products that help London renters reduce energy use",
  "numberOfIdeas": 12,
  "deepSearchCount": 2,
  "maxSearches": 3,
  "maxResultsPerSearch": 3
}
```

Only `prompt` is required. The numeric fields are positive integers with the defaults shown above. They are intentionally not capped for trusted local callers; a network deployment must enforce authentication, quotas, request-size limits, and concurrency policy at its gateway.

The response is:

```json
{ "ideaJobId": "<uuid>" }
```

The `Location` header points to `/api/idea-jobs/:ideaJobId`.

### `GET /api/idea-jobs`

Returns newest-first history as `{ "ideaJobs": [...] }`. The optional `limit` query parameter defaults to 100 and is capped at 200.

### `GET /api/idea-jobs/:ideaJobId`

Returns the durable prompt, requested counts, current stage, status, error, generation links, and timestamps as `{ "ideaJob": ... }`. Unknown UUIDs return 404.

### `GET /api/idea-jobs/:ideaJobId/events`

Returns the replay-and-follow NDJSON feed. Live jobs use the retained in-memory event log; database-only jobs synthesize events from durable rows. Unknown UUIDs return 404.

The event sequence is:

1. `research-prompt-stream` with the planning LLM stream ID.
2. `deep-search-started` once per child, with its job ID and research request.
3. `research-summary-stream` with the briefing LLM stream ID.
4. `idea-generation-stream` with the structured-output LLM stream ID.
5. `idea` once per validated title-and-description object.
6. `critique-generation-stream` once per idea, with the idea's zero-based `position` and free-form critique LLM stream ID. Calls are concurrent, so live events may arrive out of order; `position` is authoritative.
7. On failure, one `error` with the failing stage and message.
8. Exactly one terminal `done`.

Each stream ID is read through `GET /api/streams/:id`, which exposes reasoning and text progress independently from the parent feed. Deep-search progress is not duplicated in the parent; clients link to or subscribe to each existing `/api/deep-search-jobs/:id/events` feed.

## Persistence model

- `idea_jobs` owns the request, requested counts, current stage, lifecycle, timestamps, and three pipeline-level LLM generation links.
- A debate-created idea job points to its owning debate with `ON DELETE
  CASCADE`; standalone idea jobs leave that owner null. Deleting an idea job
  deletes its child searches and all generations owned by either level.
- Planning prompts, the research briefing, and the raw structured idea output live in the job's linked `llm_generations` rows. Every started idea critique is linked from its idea. Critique text and reasoning remain only in `llm_generations`; they are not copied into `ideas`.
- Each pipeline-level generation link is constrained to the exact idea job and
  user that own it. Critique links are unique foreign keys, and orchestration
  creates them only from critique calls owned by that same idea job. A completed
  idea job must be in the `critique` stage with all three pipeline-level
  generation links and a terminal timestamp; orchestration completes it only
  after every persisted idea has its critique link and terminal stream output.
- `ideas` is the normalized canonical representation of the validated idea set, with stable IDs and generation order. The complete validated batch is inserted before critique fan-out. Each nullable critique link is attached once when its call starts, allowing the idea to exist and display independently of critique startup.
- Child `deep_search_jobs` reference the parent with a matching owner and retain both their planning order and complete normalized research state.
- Completed idea cards and their position-keyed critique streams replay from normalized `ideas` rows. The raw structured idea output remains available for model-stream inspection, not as domain state.

On API startup, orphaned running idea jobs become `interrupted` because their provider calls and child orchestration cannot resume. Completed and failed terminal runs remain replayable after restart.
