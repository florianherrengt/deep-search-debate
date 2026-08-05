# Web gatekeep checklist

Use this checklist for recurring React, browser persistence, streaming, presentation, Storybook, and frontend testing mistakes. Read `docs/standards.md` for the governing frontend policy; this checklist preserves focused review checks instead of restating it.

- The implementation uses the existing React, MUI, React Query, React Router, and native streaming stack. Do not reintroduce a removed UI dependency without a new, documented reason.
- Each streaming workflow explicitly uses either snapshot invalidation or replayed content as its state-ownership model; do not mix competing sources of truth.
- For snapshot-backed workflows, the durable API snapshot is the single source of truth and NDJSON events only trigger invalidation, refetch, reconciliation, and reconnect behavior.
- Replayed-content reducers define reconnect, replay or duplicate handling, ordering, cancellation, completion, failure, and reopen behavior.
- Direct URLs, refresh, closing the tab, and reopening later reconstruct the same running, completed, or failed workflow from the server.
- Terminal snapshots do not keep or reopen a live event subscription.
- An unexpectedly closed or failed stream reconnects while the job remains non-terminal.
- Stale subscription errors are cleared after a successful connection, a useful update, or a refetch showing terminal state.
- Fetches and stream readers respect `AbortSignal`; all job and stream identifiers placed in URLs are encoded.
- Parse API snapshots and event payloads with Zod, including explicit date conversion rather than unchecked casts.
- Every concurrently active item streams independently in the UI; do not serialize the display merely because multiple operations run at once.
- Stream and render the intended model generation and reasoning. Do not render internal prompts, transport metadata, or raw structured provider envelopes as user-facing content.
- A failed or completed job cannot leave pending children, loading indicators, or status copy looking active; explain that concurrent work stopped when appropriate.
- Selected-item fallback is derived predictably: explicit user selection, then an active item, then the most recently completed relevant item.
- Transcript auto-scroll follows new content only when the user is already near the bottom or changes the selected item; preserve manual reading position otherwise.
- Summaries, outcomes, progress counts, stage labels, and status are derived from the snapshot rather than maintained as duplicate client state.
- The UI clearly distinguishes provisional state from final results and gives the primary outcome appropriate prominence.
- Derived workflow pages link to their source jobs; history can reopen any persisted job.
- Navigation, summaries, item lists, transcripts, long prompts, and generated titles remain usable on narrow screens and with wrapped content.
- Interactive controls have accessible names, focus behavior is visible, transcript updates use appropriate live-region semantics, and color is not the only status signal.
- Storybook covers reusable components and meaningful loading, running, completed, failed, empty, long-content, and responsive states.
- Storybook supplies global application providers such as theme and router once; do not duplicate providers in each story without a state-specific reason.
- Browser E2E tests use real application routes, orchestration, persistence, and UI with controlled model mocks, while rejecting unexpected outbound calls.
- The full mocked E2E verifies the entire workflow, concurrent streaming, the final outcome, refresh/reopen behavior, and the configured failure and retry policy.
- Focused tests cover malformed snapshots and events, reconnect after a premature stream close, stale-error clearing, terminal-state cleanup, and concurrent message rendering.
