# Text streaming

An LLM generation is represented by one stream ID from creation through completion.

`generateTextStream` invokes the model, registers its provider stream immediately, starts consuming it in the background, and returns `{ id }`. The registry buffers normalized events and keeps the stream's internal status.

Streams are currently stored in memory. Completed and failed streams remain readable for the lifetime of the API process and are lost when the process restarts.

## HTTP contract

### `POST /api/streams`

Creates and starts a text stream. The request body is:

```json
{
  "prompt": "Explain the result",
  "promptName": "default"
}
```

`promptName` defaults to `default`. The response is `201 Created` with the stream ID:

```json
{ "id": "<uuid>" }
```

### `GET /api/streams/:id`

Returns the stream as NDJSON (`Content-Type: application/x-ndjson`). It immediately replays all buffered events, then follows new events until generation finishes.

Reads are non-destructive. Concurrent readers and later reconnects each receive the full retained history. An unknown ID returns 404.

Events are:

| Type        | Payload         | Meaning                         |
| ----------- | --------------- | ------------------------------- |
| `reasoning` | `{ text }`      | Reasoning delta                 |
| `text`      | `{ text }`      | Answer delta                    |
| `error`     | `{ message }`   | Generation failed               |
| `done`      | none            | No more events will be produced |

The web client mirrors this contract in `src/web/lib/textStreams.ts`. `useTextStream` retains only the stream ID and accumulated output.
