# Gatekeep checklist maintenance

These files are living, feature-independent review checklists for recurring mistakes and durable engineering decisions. They supplement `AGENTS.md`, scoped technical documentation, and the executable `npm run gatekeep` checks; they do not replace any of them.

- [`../gatekeep.md`](../gatekeep.md) contains repository-wide and cross-cutting checks.
- [`../src/api/gatekeep.md`](../src/api/gatekeep.md) contains backend, LLM, orchestration, persistence, and streaming checks.
- [`../src/api/db/schema/gatekeep.md`](../src/api/db/schema/gatekeep.md) contains relational design, Drizzle schema, migration, and DBML checks.
- [`../src/web/gatekeep.md`](../src/web/gatekeep.md) contains React, streaming-client, UI, Storybook, accessibility, and browser-test checks.

When asked to “read `docs/gatekeep.md` and update the files”:

- Read only the checklist files whose scopes are being updated. Read the root checklist only for cross-cutting entries.
- Inspect the current conversation, review findings, test failures, and working-tree diff for mistakes that are likely to recur.
- Generalize each lesson before adding it. Do not turn these files into specifications for the feature that happened to expose the mistake.
- Add only a reusable check or durable invariant. Do not record feature names, fixed product values, one-off typos, temporary file names, or implementation details with no future review value.
- Put cross-cutting checks in the root file, backend-only checks in the API file, relational-schema checks in the schema file, and frontend-only checks in the web file.
- Avoid copying the same check into multiple files. Add a scoped companion check only when each layer has a distinct responsibility.
- Write concise assertions or imperatives. Include the reason only when a future maintainer might otherwise remove or reverse the decision.
- Update or remove stale bullets when architecture or product requirements change; a checklist that preserves obsolete rules is a bug.
- Keep the files concise enough to use during every review. Merge overlapping bullets instead of continually appending variants.
- Review the updated files together for contradictions, then run `git diff --check`. Run `npm run gatekeep` as well whenever code or executable configuration changed.
