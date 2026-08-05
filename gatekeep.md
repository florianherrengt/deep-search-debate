# Repository gatekeep checklist

Use this checklist for mistakes and invariants that cross the API and web client. Keep API-only and frontend-only checks in their scoped files.

- The root `AGENTS.md` and every relevant scoped document were read before changing code.
- Changes stay within the requested scope and preserve unrelated tracked, untracked, and in-progress user work.
- New libraries, tables, state, or abstractions remove more complexity than they add. Do not reintroduce a removed dependency without a new, documented reason.
- Generated files, downloaded tooling, local skills, database copies, screenshots, and other artifacts are included only when intentional.
- Durable facts have stable identities. Never use a JSON array position as a relational identity.
- Data which can be deterministically derived is not also persisted as a second source of truth.
- Machine-readable workflow outcomes are persisted separately from LLM explanations; application logic must not reparse prose to recover a result.
- Linked writes which must agree after a crash are committed in one transaction.
- All LLM output is treated as untrusted input and validated, including nominally free-form text.
- Durable jobs can be closed, reopened, refreshed, replayed, and inspected in their exact completed or failed state.
- Format versions are introduced only when incompatible persisted formats coexist. Once introduced, the rules for a version must never change.
- Comments explain non-obvious constraints and deliberate omissions, especially decisions that a future cleanup might otherwise undo.
- Documentation describes current behavior rather than planned or legacy behavior that cannot exist in the current database.
- Run `npm run gatekeep` after code changes, plus the relevant Storybook, build, integration, or E2E checks for the affected behavior.
