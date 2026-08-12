# Idea jobs

Idea jobs are durable pipelines that turn a user prompt into research-backed,
critiqued, selected, refined, and individually researched ideas. Each run has an internal UUID, an LLM-generated
immutable title, a readable slug, and four durable stages: `planning`,
`research`, `summary`, and `ideas`. Per-idea critique and comparative selection
are ordered subphases of `ideas`; each remains visible as its own stream and
failure stage in the event contract.

Closing the page does not cancel the run. While it is running, another
subscriber in the same API process replays the retained parent event log and
follows new events. Terminal runs evict that log and reconstruct their events
from normalized rows and persisted LLM output. A closed log is retained when
terminal persistence fails.

## Pipeline

1. One fresh planning generation creates exactly `deepSearchCount` distinct,
   non-empty `{ title, prompt }` research plans.
2. One durable deep-search job is created immediately for each prompt. All
   child rows and links become visible together, while actual execution passes
   through the process-wide deep-search queue. A scoped position preserves
   prompt order for replay and briefing construction.
3. The parent waits for every launched child to settle. Durable child
   completion returns its committed final-answer text. The parent then applies
   its separately named quality gate: extraction failures remain acceptable
   snippet fallbacks, while a failed model-generated page summary rejects the
   child. If completion or parent acceptance fails, the parent fails and no
   summary or idea generation starts.
4. One fresh summary generation receives the original user prompt and only each
   child's final-answer text. Page records, source metadata, and intermediate
   output are not copied into this call. Hidden reasoning is disabled so the
   output budget is reserved for the durable research briefing.
5. One fresh idea generation receives the original user prompt, the final
   research briefing, and `numberOfIdeas`. After the complete array passes
   validation, every `{ title, description }` is persisted and published in
   generation order with a stable ID and no critique link yet.
6. One fresh critique generation starts for each persisted idea. Each call
   receives only the original user prompt, research briefing, and that one idea.
   Hidden reasoning is disabled because some reasoning models can otherwise
   exhaust the output budget before producing critique text. The prompt limits
   each critique to 400 words and the stage caps output at 1,024 tokens; the
   downstream selector needs a concise comparison, not six essays. The calls run
   concurrently. As each call starts, its generation ID is attached to that
   idea before the stream event is published. The parent waits for every
   critique to settle before selection starts.
7. One fresh structured selection generation receives the original user prompt,
   the final research briefing passed into idea generation, and every generated
   idea paired with its critique's final text. Critique reasoning is deliberately
   excluded. Hidden selection reasoning is disabled so the bounded output is
   reserved for the required JSON. The output is an unordered array of unique idea IDs containing an
   even number of ideas from 6 through 12. Every ID must belong to this job.
   The selected ideas become `selected = true` and every other generated idea
   becomes `selected = false` in the same transaction as the selection
   generation's terminal output.
8. One fresh structured refinement generation starts concurrently for each
   selected idea. It receives the original request, shared research briefing,
   original idea, and that idea's critique. Its generation link is attached
   before publication; validated refined title and description commit together.
9. One deep-search job is then created for each refined idea. These
   searches reuse the request's existing `maxSearches`,
   `maxResultsPerSearch`, and `maxRounds`. Each search's parent-scoped position is
   `deepSearchCount + idea.position`. The parent completes only after every
   selected-idea search completes.

Any planning, child-search, summary, idea-generation, critique-generation,
selection-generation, refinement-generation, or selected-idea-search failure
fails the parent. An invalid selection count,
duplicate ID, or foreign ID is a selection failure. A critique or selection
failure does not erase already-valid ideas or critiques; selection remains null
when the selection transaction does not complete. Individual page-extraction
failures inside a child search are non-fatal when the search-result description
can be used as a fallback. A page-summary failure may likewise produce a
durably completed standalone child using its snippet, but the idea pipeline's
explicit parent-quality gate rejects it. Once concurrent work has started, the
parent waits for all of it to finish even if one operation fails, so it never
reports a terminal state while visible children or critique streams are still
running.

## HTTP contract

Creation and history require a Better Auth session. Creation records the
authenticated user as owner. Detail and event reads apply the idea-job read
scope: the owner may read a private job, while any viewer may read an idea job
belonging to a public debate. Anonymous viewers therefore receive inherited
public access; private, standalone foreign, and unknown UUIDs return 404. Public
responses omit the owner ID. Planning, summary, idea, critique, selection, and
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

Returns newest-first readable history as `{ "ideaJobs": [...] }`, including the
viewer's private jobs and jobs belonging to public debates. The optional `limit`
query parameter defaults to 100 and is capped at 200. Owner IDs are omitted.

### `GET /api/idea-jobs/:slug`

Returns the durable title, slug, prompt, internal ID, requested counts, current
stage, status, error, generation links, and timestamps as `{ "ideaJob": ... }`.
Detail responses add `isPublic`, which reports inherited public-debate
visibility, and `isIndexable`, which is true only when that debate is both
public and completed. Standalone and private owner-readable jobs report both
fields as false. These projections are detail-only and do not change the
history response. Unknown slugs return 404.

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
6. `critique-generation-stream` once per idea, with the idea's zero-based
   `position` and free-form critique LLM stream ID. Calls are concurrent, so
   live events may arrive out of order; `position` is authoritative.
7. `idea-selection-stream` with the structured selector LLM stream ID after all
   critiques complete.
8. `selected-ideas` with the unordered `selectedIdeaIds` array after the
   selector output and every selected flag commit atomically.
9. `idea-refinement-stream` once per selected idea, keyed by stable `ideaId`.
10. `refined-idea` once per completed refinement, with its improved title and
    description.
11. `idea-deep-search-started` once per refined idea, with the stable `ideaId`,
    child job ID, title, slug, and generated research request.
12. On failure, one `error` with the failing stage and message. Refinement and
    selected-idea research use the event stages `refinement` and
    `idea-research`; both remain durable subphases of the DB's `ideas` stage.
13. Exactly one terminal `done`.

Each stream ID is read through `GET /api/streams/:id`, which exposes reasoning
and text progress independently from the parent feed. Deep-search progress is
not duplicated in the parent; clients link to or subscribe to each existing
`/api/deep-search-jobs/:id/events` feed.

The server-side idea coordinator does not subscribe to these presentation
streams. It awaits each generation's durable completion handle and structured
result directly, so a validation failure cannot make the parent terminal while
the same generation still has an unfinished database write.

## Persistence model

- `idea_jobs` owns the generated title, slug, request, requested counts, current
  stage, lifecycle, timestamps, and four pipeline-level LLM generation links,
  including comparative selection. The title and slug have no update route.
- A debate-created idea job points to its owning debate with `ON DELETE
  CASCADE`; standalone idea jobs leave that owner null. Deleting an idea job
  deletes its child searches and all generations owned by either level.
- Planning prompts, the research briefing, raw structured idea output, and raw
  structured selection output live in linked `llm_generations` rows. Every
  started idea critique is linked from its idea. Critique text and reasoning
  remain only in `llm_generations`; they are not copied into `ideas`.
- Each pipeline-level generation link is constrained to the exact idea job and
  user that own it. Critique links are unique foreign keys, and orchestration
  creates them only from critique calls owned by that same idea job. Critique
  and selection stay event subphases rather than adding durable DB stages.
- `ideas` is the normalized canonical representation of the validated idea set,
  with stable IDs and generation order. The complete batch is inserted before
  critique fan-out. Each nullable critique link attaches once when its call
  starts. The nullable selected flag then transitions once from pending to true
  or false when selection commits. Selected rows additionally own a one-time
  refinement generation link and refined title/description pair. No extra
  refinement or join table is used.
- New jobs complete only after every idea has terminal critique output, the
  selection generation is terminal, every selected flag has resolved, and all
  selected ideas have completed refinement and attached deep research.
- Child `deep_search_jobs` reference the parent with a matching owner and retain
  both their planning order and complete normalized research state. Initial
  research uses positions below `deepSearchCount`; selected-idea research uses
  `deepSearchCount + idea.position`. Replay and debate context derive that
  relationship; the idea does not store a redundant child-search ID.
- Idea cards, critique streams, and selected or rejected presentation replay
  from normalized `ideas` rows. Raw structured outputs remain available for
  stream inspection, not as duplicated domain state.

On API startup, orphaned running idea jobs become `interrupted` because their
provider calls and child orchestration cannot resume. Completed and failed
terminal runs remain replayable after restart.
