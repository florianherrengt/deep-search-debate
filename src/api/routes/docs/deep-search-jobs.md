# Deep-search jobs

Deep search runs independently of its HTTP readers. The route module owns an in-memory job map that buffers events for each job.

Jobs and their events survive reader disconnects but are lost when the API process restarts. Reads are non-destructive.

## HTTP contract

### `POST /api/deep-search`

Starts a deep-search job immediately:

```json
{
  "researchRequest": "What changed in the market?",
  "maxSearches": 3,
  "maxResultsPerSearch": 3
}
```

Both limits are optional positive integers and default to `3`. Generated queries are ordered by research priority, and only the first `maxSearches` queries are sent to SearXNG. For each executed search, result IDs are ordered by exploration priority, and only the first `maxResultsPerSearch` links are selected for future page extraction. The web client currently sends both defaults without exposing controls.

Returns `202 Accepted` with the job ID:

```json
{ "id": "<uuid>" }
```

### `GET /api/deep-search/:id`

Subscribes to the job as NDJSON. Buffered events are replayed first, followed by live events until the job finishes. An unknown ID returns 404.

The first event identifies the LLM stream that is generating the search queries:

```json
{ "type": "query-stream", "streamId": "<uuid>" }
```

The frontend subscribes to that stream through `GET /api/streams/:streamId`, so query text is rendered while the model generates it. The backend independently consumes the same retained stream to obtain the final query list.

After those queries have run through SearXNG, the job emits:

```json
{
  "type": "search-results",
  "searches": [
    {
      "query": "generated search query",
      "results": [
        {
          "title": "Result title",
          "shortText": "Result snippet",
          "link": "https://example.com"
        }
      ]
    }
  ]
}
```

For each executed search query, selection then emits two events. The first identifies the LLM stream that is selecting results:

```json
{
  "type": "selection-stream",
  "query": "generated search query",
  "streamId": "<uuid>"
}
```

The frontend follows that text stream while selection runs. When selection finishes, the job publishes the selected result links:

```json
{
  "type": "selected-search-results",
  "query": "generated search query",
  "selectedLinks": ["https://example.com/selected-result"]
}
```

Selected links enter the extraction phase immediately. Exact duplicate URLs across search queries are extracted and summarized only once. When extraction succeeds and summary generation starts, the job announces the retained text stream:

```json
{
  "type": "page-summary-stream",
  "url": "https://example.com/selected-result",
  "streamId": "<uuid>"
}
```

The frontend follows each announced stream through `GET /api/streams/:streamId`. Summary subscriptions run independently so one page cannot block discovery of streams for other selected pages. The backend also follows the retained stream so its completed text can be used in the query-level synthesis. Buffered summary output remains replayable after generation completes.

If extraction or summary stream registration fails before a stream exists, the job publishes a non-fatal page event and continues processing the other selected URLs:

```json
{
  "type": "page-summary-error",
  "url": "https://example.com/selected-result",
  "stage": "extraction",
  "message": "Page extraction failed"
}
```

After a summary stream is registered, that stream owns its generation status and reports any generation failure through `GET /api/streams/:streamId`. The deep-search job does not duplicate those failures. If extraction, stream registration, or summary generation fails, query synthesis falls back to that result's search description.

After all selected page-summary streams have settled, the pipeline builds one synthesis input for every executed search query. Every returned result is included in its original order with its title, URL, and a uniform content field. The content is the completed extracted-page summary when that URL was successfully explored, including when the same URL was explored for another query; otherwise it is the original search description. The synthesis agent is not told which form was used.

Each query synthesis emits its retained text stream:

```json
{
  "type": "query-summary-stream",
  "query": "generated search query",
  "streamId": "<uuid>"
}
```

The query summary receives both the original research request and the executed search query and returns plain Markdown. Query-summary streams are registered in parallel.

The job feed terminates with `done` after every query-summary stream has been registered. Those query-summary streams may still be running; the frontend continues following them independently. Job-level failures emit `error` with a public message before `done`.

The `/deep-search` page renders collapsible query generation and result groups. Each result group contains its live query summary, the selection output, selected/rejected result styling, and live page summaries for selected results.
