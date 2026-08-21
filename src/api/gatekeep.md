# API gatekeep checklist

Use this checklist for recurring backend, orchestration, LLM, persistence, and streaming mistakes. Read `db/schema/gatekeep.md` for schema changes.

- Read `docs/runtime.md`, `docs/standards.md`, `docs/testing.md`, and every relevant route, database, or prompt document before changing their areas.
- Keep Hono routes under `/api`. Validate request, response, event, database-boundary, and LLM-boundary data with Zod.
- Retry behavior is explicit at every orchestration boundary. Do not silently add retries to a workflow whose contract is to expose failures for debugging.
- Free-form model output is rejected when it is empty or whitespace-only before the workflow advances.
- Already-started concurrent work is awaited or settled on failure so background writes do not escape the failed operation.
- Structured model output is actually constrained and parsed with Zod. Preserve generation and reasoning required by the streaming contract without exposing raw provider envelopes as UI content.
- Malformed or schema-invalid structured model output fails the generation and workflow. Do not repair, normalize, default, filter, or application-retry it; change the prompt or schema deliberately, or switch the configured model.
- A durable outcome and its human-readable explanation are persisted atomically. Never recover a machine-readable result by reparsing prose.
- Enforce workflow-wide invariants in application code when expressing them as SQL constraints would require duplicated keys or disproportionate schema complexity.
- Validate that related records belong to the same owning job or aggregate before inserting cross-record references.
- Validate collection-wide rules before insertion, such as uniqueness across multiple rows, valid counts, non-repetition, and prerequisite completion.
- Calculations based on a batch use one consistent input snapshot and apply their writes atomically after the entire batch completes.
- Deterministic behavior has an explicit final tie-breaker rather than relying on database row order.
- Give each model only the context its role requires. Give privileged evaluators all context required for a valid decision.
- Clearly delimit user, search, source, and prior model text as untrusted prompt context that cannot override system instructions.
- Independent work is concurrent where safe, while dependent stages do not begin until all required prior work has completed successfully.
- A durable job or stream identifier is persisted and returned before events can be published, so fast events cannot race subscription setup.
- Stream events are lightweight invalidations of the durable snapshot, not a second authoritative copy of workflow state.
- A run emits exactly one terminal `done` event on success and a useful error event on failure, with reconnect/replay supported from persisted state.
- Recovery distinguishes genuinely orphaned work from a crash after the durable terminal result was written, and reconstructs the correct terminal state from persisted facts.
- Ownership-sensitive creation, batch insertion, and completion operations are transactional whenever partial persistence would create an invalid or misleading state.
- Failure tests cover malformed or empty model output, exact error propagation, configured retry behavior, prevention of dependent work, restart recovery, replay, and every workflow-wide invariant enforced in application code.
