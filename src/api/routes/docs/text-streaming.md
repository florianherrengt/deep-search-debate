# Text streaming

An LLM invocation has one UUID for its complete lifecycle. `generateTextStream` creates an `llm_generations` row with null `text` and `reasoning`, consumes provider deltas in memory, and returns the UUID immediately.

Deltas are not written to SQLite. At the terminal boundary, the consumer performs one database update with the accumulated text, accumulated reasoning, status, error, and completion time. This keeps writes conservative while making completed output durable.

After that terminal update succeeds, the in-memory delta log is evicted and late readers reconstruct the output from SQLite. If terminal persistence fails, the closed live log is retained because it is the only available copy of the terminal error and `done` events.

## HTTP contract

### `POST /api/streams`

Starts generation and returns `201 Created`:

```json
{ "id": "<uuid>" }
```

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
| `error`     | `{ message }`   | Generation failed               |
| `done`      | none            | No more events will be produced |

A server restart marks orphaned `running` generations as `interrupted`; provider streams themselves are not resumable.
