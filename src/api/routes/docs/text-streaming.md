# Text streaming

An admitted LLM invocation has one UUID for its complete lifecycle. Calls still
waiting for a per-user Codex reservation or in the process-wide queue have no
generation row; an internal workflow interruption can remove that waiting work
without registering an invocation. A Codex reservation is acquired before the
shared queue without decrypting credentials or starting a process, so same-user
serialization does not consume global generation capacity. Once admitted, the
adapter first creates an `llm_generations` row with null `text` and `reasoning`
and commits any owning-stage registration hook. Only then may it construct the
provider stream, consume deltas in memory, and return a handle containing the
UUID.

Deltas are not written to SQLite. At the terminal boundary, the consumer performs one database update with the accumulated text, accumulated reasoning, status, error, and completion time. This keeps writes conservative while making completed output durable.

Registration also stores the requested model ID and prompt name. When the
Pi exposes them, the terminal update stores its normalized
finish reason plus input, output, and reasoning token counts. A normal finish
reason is required for success; missing or rejected finish metadata fails the
generation closed. Usage metadata is best-effort and remains null when
unavailable. Duration is derived from the existing timestamps instead of being
stored twice.

Each invocation snapshots the current user's exact Small or Big provider,
model, and reasoning-effort assignment before provider reservation and shared
admission. This lets the next stage of an active or resumed workflow observe a
successful Settings update. DeepSeek choices use positive-credit admission and
normal LLM settlement even when OpenAI is connected. OpenAI choices take the
per-user reservation, recheck the connection before decrypting credentials,
verify the exact model and effort against Pi's direct Codex catalog, and
record zero product credits for that LLM generation. Search and extraction
settle independently. An expired, rate-limited, broken, or unavailable explicit
OpenAI choice fails without falling back to DeepSeek; only a missing implicit
OpenAI recommendation may use its DeepSeek counterpart.

Every LLM call shares one process-wide admission queue (four active generations
by default), including text, structured output, and title generation. A permit
is held until the durable terminal generation transaction settles; provider
retries cannot bypass it. Every streaming provider call has configured total,
first-content, and inter-content deadlines. Server-funded providers also apply
an explicit output-token ceiling, with narrower stage budgets where
appropriate. Pi's direct Codex transport does not send an output-token cap, so
OpenAI-connected calls intentionally have no Codex-specific cap beyond the
shared deadlines and cancellation behavior. Every prompt name maps
exhaustively to Small or Big; the selected role's reasoning effort is
authoritative for text and structured generation alike. Older call-site
enabled/disabled arguments remain accepted only for compatibility and cannot
override it. DeepSeek `none` disables thinking; every other supported effort
enables thinking with that exact effort. A stream
is successful only when the provider reports the normal `stop` finish reason;
for Codex, its raw finish reason must also be `completed`. An unsolicited raw
Codex `interrupted` finish is a safe provider failure, while a user- or
parent-owned workflow signal remains the authoritative interruption path.
`length`, `content-filter`, `tool-calls`, `error`, and `other` preserve their
partial text for diagnosis but commit the generation and owning stage as
failed. Finish-reason metadata is required and fails closed when unavailable;
usage metadata remains best-effort. Provider request envelopes are not written
to application logs. The durable
generation row retains only an authorized failure message and all generation
metadata. At the stream-consumption boundary, server-funded provider errors are
replaced with the fixed `Text generation failed` message before live
publication, persistence, or replay; known Codex errors retain their fixed safe
actionable messages and codes. Successful and interrupted generations produce
no console log.

A failed metadata-bearing generation emits one privacy-safe error record with
its generation ID, owning job ID when present, prompt/stage, model ID, and finish
reason. It deliberately excludes token counts, duration, prompt, output,
reasoning, provider response body, page content, credentials, and error text.
The authorized local database row retains the same safe public error message,
plus non-sensitive generation metadata. Known Codex failures also carry their
stable safe code through the in-memory durable completion outcome so
synchronous HTTP callers retain actionable status codes; only the fixed safe
message is persisted.

Internal registration returns `{ id, completion }`. The ID is available as
soon as the initial `llm_generations` row and any registration hook commit.
`completion` resolves to a typed completed, failed, or interrupted outcome only
after the terminal generation transaction commits. Provider errors, provider
deadlines, ordinary abort-like errors, and empty output are durable failed
outcomes. Only the tagged signal owned by a workflow manager produces an
interrupted outcome, classified internally as `user-stop` or `parent-stop`.
A failure to commit terminal persistence rejects the promise. Text, array, and
object generation adapters all expose this same handle, so workflow code can
await durable completion without subscribing to the public event stream.

Text generations may register transactional lifecycle hooks. Registration
hooks link a newly inserted generation to its owning stage before provider
construction or consumption starts. Completion and failure hooks run in the
same transaction as the generation's terminal update, so a deep-search query or
page cannot claim a different outcome from its LLM generation. Deep-search
candidate answers are linked to their round at registration; after completion,
a separate promotion transaction verifies the required query rows, links that
same generation as the final answer, and completes the job. A hook or terminal-write failure rejects
`completion`; it is not converted into an ordinary provider failure.

Terminal settlement compare-and-swaps the durable generation from `running`.
If another callback or restart reconciler has already settled that attempt, the
losing callback returns the persisted terminal outcome and does not debit
credits or invoke its owning-stage completion hook again. Workflow checkpoint
retry registration likewise replaces only the exact linked failed,
interrupted, or stale-running attempt. Interrupting a stale-running attempt and
repointing the owning link to the replacement commit atomically.

An active manager interruption preserves accumulated text and reasoning, writes
`interrupted`, its stop explanation, and the completion timestamp, and runs the
stage's interruption hook in that same terminal transaction. Interrupted
generations do not debit RethinkLoop credits. This accounting guarantee does not
imply that the upstream provider will waive billing for work it already
performed. An interruption-hook or terminal-write failure fails closed and
rejects `completion`; the queue permit remains held until that durable cleanup
settles.

After that terminal update succeeds, the in-memory delta log is evicted and late readers reconstruct the output from SQLite. If terminal persistence fails, the closed live log is retained because it is the only available copy of the terminal error and `done` events.

## HTTP contract

### `POST /api/streams`

Starts generation and returns `201 Created`:

```json
{ "id": "<uuid>" }
```

The prompt must contain non-whitespace content and uses the configured research
request length ceiling. Per-user active standalone generation admission is two
by default. Excess work returns `429` before prompt loading or provider work.

### `GET /api/streams/:id`

Returns NDJSON. A live invocation replays buffered in-memory deltas and follows new ones. If the invocation is no longer in memory, its terminal reasoning, text, error, and `done` event are synthesized from `llm_generations`. Reads are non-destructive.

Stream creation requires authentication. A stream read is available to its
owner, or anonymously when the generation belongs anywhere inside a public
debate aggregate. Standalone streams and streams under private debates remain
owner-only and return 404 to every other viewer.

| Type        | Payload         | Meaning                         |
| ----------- | --------------- | ------------------------------- |
| `reasoning` | `{ text }`      | Reasoning delta or full replay  |
| `text`      | `{ text }`      | Answer delta or full replay     |
| `error`     | `{ message }`   | Generation failed or interrupted |
| `done`      | none            | No more events will be produced  |

An interrupted durable row replays any accumulated reasoning and text, followed
by its persisted `error` and `done`; there is no separate public text-stream
event type for interruption. Provider streams themselves are not resumable
after a server restart. When a dependent research workflow reaches a linked
stale-running generation during checkpoint reconciliation, registration of its
replacement atomically marks the old attempt interrupted and repoints only that
stage's exact generation link. Completed generation output remains directly
replayable and is never regenerated merely because the process restarted.
