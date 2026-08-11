# Research pipeline architecture checkpoint

Date: 2026-08-11

## Verdict

**Approve.** The architecture is internally bounded and the repository gate,
production web build, Storybook build, and mocked full-stack Playwright suite
pass.

The architecture now fits the current product and codebase. It uses one
in-process coordinator per workflow, the existing AI SDK, `p-queue`, Hono,
Drizzle, SQLite, Zod, and small replayable event logs. It does not add a workflow
service, message broker, event-sourced database, repository framework, or a
parallel state model.

## Current pipeline

```text
bounded query generation
-> concurrent web search
-> ordered result selection
-> bounded unique-page extraction and summary
-> concurrent per-query synthesis
-> optional structured round review
-> repeat below maxRounds, or produce the final answer
```

`routes/deepSearch/pipeline.ts` owns this sequence. Agent modules own provider
calls, prompt formatting, extraction, and validation. Store modules own
normalized database mutations. Typed events are lightweight progress
notifications and replay input; they do not perform writes.

## Significant issues resolved

### Provider work could run forever

LLM streams now use total, first-content, and inter-content deadlines supported
by the installed AI SDK. Non-streaming title calls use the total deadline. Web
search uses a native abort deadline and forwards its signal into both Brave and
SearXNG. The SDK's default full-error logger is suppressed; durable failure
state and bounded structured metadata remain available without logging provider
request envelopes.

### Per-child limits did not bound a complete root workflow

Requests now have a 400-page aggregate worst-case selected-page budget by
default. Idea jobs account for initial child searches plus the maximum 12
selected-idea searches. Existing per-round breadth and hard round limits remain.
The ordinary default idea/debate workload fits; maximal combinations fail
validation before title generation or durable job creation.

### Admission raced with title generation

Root capacity is reserved synchronously before the asynchronous title preflight
and released after the durable root row exists or creation fails. A second
request therefore cannot consume a title call for the same final slot. Direct
standalone LLM streams use the same reservation pattern and have their own
per-user active limit.

### Eager child batches could delay later root work

The existing process-wide `p-queue` remains. Newly admitted root searches have
higher queue priority than waiting child searches; active jobs are not
pre-empted. This fixes batch starvation without introducing a scheduler
service. Aggregate budgets and per-user root admission bound each user's queued
work.

### Workflow generation ownership was attached after streaming began

Idea planning, briefing, generation, critique, selection, refinement, and
debate transcript links now use the stream registry's registration transaction.
The `llm_generations` row and its owning workflow link either both commit before
provider stream construction or consumption or neither does. Terminal callbacks retain the same
atomicity for selection flags, refined output, query/page completion, final
answers, and judge verdicts.

### LLM fan-out could overwhelm the provider

Every text, structured, and title generation now passes through one
process-wide queue. The default permits four active generations, and a permit
is held across SDK retries and durable terminal persistence. Stage-specific
output budgets sit below the operator ceiling, while accumulated query, idea,
and debate inputs use fair bounded projections that preserve one entry per
item.

### Provider data crossed boundaries without hard normalization

Search responses now have byte, row, and field ceilings. Only canonical unique
public HTTPS results reach persistence or prompts, and result fields are
serialized as untrusted data. Extraction accepts recognized text documents and
PDFs but rejects declared non-document media and binary-looking untyped bodies.

### Replay facts could be rewritten or stored twice

Selection generation attachment and selected-result commit are one-shot
compare-and-swap transitions, preventing retries from changing a terminal
selection or orphaning a page. Selected-idea research is resolved from the
child's parent-scoped position; the redundant mutable
`ideas.deep_search_job_id` column and its compatibility machinery are gone.

### Root and nested budgets had lifecycle gaps

Running debate jobs retain a root slot through the complete tournament, even
after their owned idea job finishes. Maximum-length external prompts are
budgeted before refined-idea child requests are built, and generated idea fields
have explicit limits, so a valid request cannot fail late merely because the
pipeline added internal framing.

### Valid Swiss rounds could dead-end the tournament

Score-aware pairing previously guaranteed only the current non-repeating round.
With six candidates, three locally valid perfect matchings could leave two
disconnected triangles and make rounds four and five impossible. Pairing now
accepts a current matching only when the remaining opponent graph can still be
decomposed into every required future round; the feasibility search is memoized
and bounded by the admitted 6–12 candidate field.

### Model-valid output could fail arbitrary local limits

Live DeepSeek output exposed two cases. Hidden reasoning could consume the
entire page/query synthesis budget before durable text, so evidence
transformation stages now disable it. Generated research titles could exceed a
duplicate 80-character schema rule; title length now has one owner in identity
persistence, which normalizes every supplied title without rejecting the whole
plan.

### Internal code subscribed to its own presentation streams

Internal callers now await `{ id, completion }` handles and typed structured
`output` promises. `collectStreamText`, `waitForTextStream`, and the unused array
`elementStream` surface were deleted. `POST /api/streams` returns only `{ id }`,
so a promise can no longer leak into JSON serialization.

### Public access could be revoked while anonymous streams stayed connected

Public visibility is monotonic while a debate is running. Owners may publish at
any time but may make a debate private only after it is terminal. This preserves
the existing NDJSON transport without pretending that authorization can revoke
an already accepted response mid-stream. The UI disables the unsafe transition
and explains when it becomes available.

## Persistence and recovery assessment

The normalized SQLite model is justified because queries, pages, generations,
ideas, matches, and messages have stable identities and independent lifecycle.
There is no duplicate workflow snapshot or database event log. Live token
deltas remain process-local; terminal content and structural facts are durable.
Restart recovery marks genuinely orphaned external work interrupted and keeps
completed state replayable.

The migration history is one fresh baseline. No old-schema compatibility code,
dual reads, backfill path, format branch, or legacy adapter remains.

## Deliberate limitations

Unknown or duplicate result IDs returned by the selection model are still
dropped before persistence. A code comment records this. Turning malformed IDs
into a fatal selection error would change the product's current failure policy,
so it should be decided and tested separately.

The queues and reservations are process-local. That is correct for the current
single-process SQLite deployment. Multiple API replicas would require shared
leases/admission and different multi-writer persistence; adding that now would
be speculative complexity.

## Final real-provider verification

The final clean run used native DeepSeek `deepseek-chat`, the local SearXNG
adapter, and ScrapingAnt. The complete six-candidate tournament finished with
five Swiss rounds, two semifinals, and one final: 7 durable round rows, 18/18
completed matches, 90 transcript messages, 7/7 completed research jobs, and
131/131 completed LLM generations with no failed or running generation left.
The Swiss schedule contained no repeated opponent pair, every match had exactly
five ordered messages, every generation used the configured DeepSeek model,
foreign-key validation returned no rows, and SQLite `integrity_check` returned
`ok`.

The smoke used the normal debate endpoint with the shared idea/deep-search
controls set to one initial search, one query, one selected result, and one
round. The defaults remain `2`, `3`, `3`, and `3`. Earlier real runs exercised
the full three-round adaptive research path, real browser extraction, and
snippet fallback before exposing the model-budget and Swiss-scheduling defects.

Live debugging produced four additional fixes:

- empty SearXNG result sets now complete without fabricating selection or
  summary generations;
- SearXNG requests are serialized and rate-spaced, and the configurable
  `general,science` profile retains useful sources when general engines throttle;
- structured idea selection disables hidden reasoning, while critiques are
  explicitly limited to 400 words and 1,024 output tokens;
- debate creation reuses the existing validated research controls, enabling a
  full real-provider tournament smoke without a parallel test-only pipeline.

After process restart, debate detail still reported `final/completed` with all
18 matches, nested idea/search/generation replay endpoints returned HTTP 200,
and the debate NDJSON replay remained byte-identical with SHA-256
`a8203a8abbd05d8e48a373cf2435114278280f673f220f0e0f861a633db63731`.
The final deterministic checks also passed: 362 API tests, 106 web unit tests,
all 6 Playwright scenarios, the production web build, the Storybook build, and
`git diff --check`.
