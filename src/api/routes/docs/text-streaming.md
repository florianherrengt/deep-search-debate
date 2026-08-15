# Text streaming

An admitted LLM invocation has one UUID for its complete lifecycle. Calls still
waiting in the process-wide queue have no generation row; an internal workflow
interruption can remove that queued work without registering an invocation. Once
admitted, the adapter first creates an `llm_generations` row with null `text` and
`reasoning` and commits any owning-stage registration hook. Only then may it
construct the provider stream, consume deltas in memory, and return a handle
containing the UUID.

Deltas are not written to SQLite. At the terminal boundary, the consumer performs one database update with the accumulated text, accumulated reasoning, status, error, and completion time. This keeps writes conservative while making completed output durable.

Registration also stores the requested model ID and prompt name. When the
installed AI SDK exposes them, the terminal update stores its standardized
finish reason plus input, output, and reasoning token counts. A normal finish
reason is required for success; missing or rejected finish metadata fails the
generation closed. Usage metadata is best-effort and remains null when
unavailable. Duration is derived from the existing timestamps instead of being
stored twice.

Every LLM call shares one process-wide admission queue (four active generations
by default), including text, structured output, and title generation. A permit
is held until the durable terminal generation transaction settles; provider
retries cannot bypass it. Every streaming provider call has configured total,
first-content, and inter-content deadlines plus an explicit output-token
ceiling. Individual stages use narrower budgets where appropriate instead of
giving small structured responses the full operator ceiling. A stream
text caller must also choose `enabled` or `disabled` reasoning explicitly;
there is no silent text-generation default. Structured array calls disable
reasoning, while structured object calls disable it unless a stage deliberately
opts in. Evidence-transformation stages—page summary, query synthesis, final
answer, idea briefing, idea evaluation, and debate advocacy—also disable hidden
reasoning so it cannot exhaust the shared output budget before required text is
emitted. A stream
is successful only when the provider reports the normal `stop` finish reason;
`length`, `content-filter`, `tool-calls`, `error`, and `other` preserve their
partial text for diagnosis but commit the generation and owning stage as
failed. Finish-reason metadata is required and fails closed when unavailable;
usage metadata remains best-effort. The AI SDK's default full-error
logger is disabled so
provider request envelopes are not written to application logs. The durable
generation row retains the authorized failure message, while terminal console
records stay limited to IDs, stage, model, status, usage, and duration.

Every metadata-bearing generation emits one structured terminal console record
with generation ID, owning job ID when present, prompt/stage, model ID, status,
finish reason, token counts, and derived duration. It deliberately excludes the
prompt, output, reasoning, provider response body, page content, credentials,
and error text. Detailed failure text remains available in the authorized local
database row.

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
event type for interruption. A server restart marks orphaned `running`
generations as `interrupted`; provider streams themselves are not resumable.
