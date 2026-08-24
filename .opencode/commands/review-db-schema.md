Review the database schema comprehensively using multiple independent subagents.

First, inspect the repository to understand:

- the database technology and ORM/query layer
- the complete current schema and migrations
- how the application actually reads and writes the database
- important product/domain constraints represented in the data model

Then spin up independent subagents in parallel. Give each agent a distinct review angle so they genuinely investigate different failure modes rather than repeating a generic schema review.

At minimum cover:

- **Data modelling:** table boundaries, relationships, normalization/denormalization, ownership and lifecycle.
- **Data integrity:** PKs, FKs, unique constraints, nullability, CHECK constraints, cascades, impossible/invalid states.
- **Query performance:** indexes, composite/partial indexes, likely query patterns, joins, scans, pagination, sorting and filtering.
- **Application usage:** compare the schema against actual repository queries and mutations; identify mismatches or assumptions only enforced in application code.
- **Concurrency & transactions:** races, duplicate creation, lost updates, atomicity, idempotency and transaction boundaries.
- **Migrations & evolution:** whether the schema can evolve safely, migration hazards, backwards compatibility and destructive changes.
- **Security & isolation:** accidental data exposure, tenant/user ownership, authorization assumptions and DB-level protections where applicable.
- **Scale & storage:** growth of high-volume tables, unbounded data, hot rows, write amplification, retention and likely future bottlenecks.
- **Operational reliability:** backups/restores, deletion behaviour, timestamps, auditability, recoverability and cleanup.
- **Simplicity & maintainability:** unnecessary complexity, duplicated concepts, awkward abstractions, naming and areas that can be simplified.

Add other specialist reviews if the repository suggests they are warranted.

Subagents should inspect the actual code relevant to their area, not just the schema definition. They should distinguish between:

1. concrete bugs or integrity risks,
2. likely future problems,
3. worthwhile improvements,
4. harmless theoretical concerns that do not justify changes.

After all reviews finish, synthesize their findings yourself. Deduplicate overlapping observations and resolve disagreements by checking the code where necessary.

Do **not** modify anything.

Produce one concise final report containing:

### Overall assessment

A short explanation of how sound the schema is and the main themes.

### Critical issues

Problems that can cause incorrect data, security issues, data loss, or serious production failures.

### Important improvements

Issues worth addressing but that are not immediately dangerous.

### Performance and scale

Only meaningful findings supported by expected or actual access patterns.

### What is already well designed

Call out decisions that should probably be kept.

### Recommended changes

A prioritized list of concrete changes, including why each matters.

### Bottom line

Your assessment of whether the schema is fundamentally sound, needs targeted fixes, or needs substantial redesign.

Prioritize substantive issues over stylistic nitpicks. Do not recommend complexity merely because it is theoretically more robust.

Do not change the code.
