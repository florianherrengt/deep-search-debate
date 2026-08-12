# Deep-search simplification migration record

Status: complete. `npm run gatekeep` and the mocked full-stack Playwright suite
pass.

This record replaces the old forward-looking migration plan. It describes the
architecture that now exists. The migration retained adaptive rounds, typed
events, intermediate LLM streams, normalized persistence, replay after restart,
idea-owned child searches, and the established failure policies without adding
a workflow engine, event store, broker, or compatibility layer.

## Completed sequence

1. Characterize the existing event order, replay behavior, and failure policy
   with focused tests.
2. Bound search breadth, result breadth, rounds, request length, per-user root
   work, aggregate selected pages, process concurrency, and standalone LLM
   generation.
3. Add adaptive rounds controlled by one structured review generation and a
   server-enforced `maxRounds` hard stop.
4. Make every model adapter return one internal `{ id, completion }` handle;
   structured adapters add one typed `output` promise.
5. Replace event-driven persistence with explicit store commands carrying
   stable round, query, result, and page IDs.
6. Put stage ordering, URL/query deduplication, fallbacks, and the bounded round
   loop in `routes/deepSearch/pipeline.ts`.
7. Make generation registration and its owning workflow link one transaction,
   and make terminal generation state and its domain outcome one transaction.
8. Flatten the discarded database history into one fresh baseline. No upgrade
   or legacy-schema compatibility path remains.
9. Delete the reverse control path: internal workflows no longer subscribe to
   `/api/streams` to recover their own output, and no `collectStreamText`,
   `waitForTextStream`, or unused structured element stream remains.
10. Add bounded provider deadlines, pre-title admission reservations, root
    priority over queued child batches, safe standalone stream responses, and
    durable operational metadata.
11. Put every LLM call behind one provider-boundary concurrency queue, persist
    generation ownership before constructing its provider stream, and give
    each stage a bounded output budget under the operator ceiling.
12. Bound and normalize provider results, reject binary extraction bodies,
    serialize result fields as untrusted prompt data, and make selection commit
    a one-shot compare-and-swap transition.
13. Remove the redundant idea-to-search reverse link. Selected-idea research is
    derived from the child position already owned by the idea job.
14. Move answer generation inside the bounded round loop. Persist one candidate
    generation per round, review that answer, feed the review reason into the
    next query plan, and promote the accepted or final permitted candidate
    without a duplicate synthesis call.

## Current ownership model

```text
runDeepSearchJob             terminal job success/failure and public terminal events
`- runDeepSearchPipeline    rounds, stage order, fallback policy, deduplication
   |- agent adapters         prompts, provider calls, extraction, output validation
   |- store commands         normalized transactional state changes
   `- job.publish            lightweight notification after the owning write

llms/streams.ts              generation registration, live deltas, terminal persistence
SQLite                       authoritative workflow and replay state
frontend reducers            live presentation reconstructed from typed events/rows
```

The write-side invariant is:

```text
register generation + owning link atomically
-> publish its stream ID
-> await typed output and durable completion
-> persist the next domain boundary
-> publish the matching progress event
```

Already-started concurrent work is settled before a parent becomes terminal.
Events do not cause database writes and are not a second source of truth.

## Resource model

- A user may have two active root research workflows by default. A process-local
  reservation is acquired before the asynchronous title preflight, so racing
  requests cannot both spend provider work for one remaining slot.
- Every root workflow has an aggregate worst-case selected-page budget of 400 by
  default. An idea job accounts for its initial searches plus at most 12
  selected-idea searches.
- Deep-search execution uses one process queue with concurrency two. Newly
  admitted roots have priority over already queued children; running work is
  never pre-empted.
- Selected-page extraction and summarization use a second process queue with
  concurrency four. ScrapingAnt retains its stricter single-request queue.
- Every LLM call shares a process queue with concurrency four. LLM streams and
  web searches have typed deadlines. Direct `/api/streams` requests use the
  research prompt-size ceiling and a per-user active limit.
- Provider search responses have byte, row, and field ceilings and are reduced
  to canonical unique public HTTPS results before persistence.

These controls match the current single-process SQLite deployment. Moving to
multiple API replicas would require a shared admission/lease mechanism and a
database suited to multi-writer orchestration; that is not a current
requirement and is deliberately not implemented.

## Deliberately deferred behavior

The selection adapter still drops unknown or duplicate model-returned result
IDs before persistence. The TODO is documented beside that mapping in
`agents/deep_search/selection.ts`. Changing it to a fatal validation error
changes the established failure policy, so it remains a separate product
decision rather than hidden inside this architecture migration.

## Acceptance criteria

- Adaptive research never exceeds the hard round or aggregate page bounds.
- Every generation has one immutable workflow owner before consumption starts.
- Terminal workflow facts and generation outcome cannot disagree after a
  successful transaction.
- Completed and failed work replays from normalized SQLite rows.
- A browser disconnect does not cancel provider work.
- Public debates remain public while live anonymous streams may exist; owners
  can revoke them after termination.
- No legacy schema, old persistence adapter, or internal public-stream consumer
  remains.
- `npm run gatekeep` passes.
