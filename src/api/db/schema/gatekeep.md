# Database schema gatekeep checklist

Use this checklist for recurring Drizzle schema, relational-model, migration, and DBML mistakes. Read `../docs/database.md` first.

- Model durable facts, not projections or caches that can be deterministically reconstructed.
- Give relational records stable primary keys. Treat positions, labels, and array offsets as metadata, never identity.
- Normalize repeated data when another record must reference it, its order must survive replay, or elements have their own lifecycle.
- Add join tables only for real independent concepts such as many-to-many membership, reuse, or relationship-specific metadata.
- Persist machine-readable outcomes separately from human-readable explanations; application logic must never recover state by parsing prose.
- Persist only information that cannot be recovered reliably. Omit redundant categories and duplicated summary state.
- Store an explicit position when order is semantically important. Timestamps are not ordering keys and can tie under concurrency.
- Give ordering columns distinct meanings; avoid both a global sequence and a scoped position when one is derivable.
- Make nullability reflect lifecycle states. Couple columns that must transition together with row-level checks.
- Use SQL checks for row-local invariants, including allowed values, ranges, non-empty trimmed content, mutually exclusive fields, and valid local references.
- Keep workflow-wide and cross-row invariants in transactional application validation when SQL enforcement would require duplicated ownership keys or disproportionate complexity.
- Add a foreign key for every durable relation and choose deletion behavior deliberately: cascade owned children, protect independently valuable records, and account for SQLite cascade timing.
- Use `references(() => table.column)` for single-column foreign keys. If a circular inference needs type erasure, annotate that callback with `AnySQLiteColumn`; do not add a getter that preserves the same module import cycle.
- Document ownership invariants that ordinary foreign keys do not enforce, such as two referenced records belonging to the same parent.
- Scope uniqueness to the owning aggregate when values only need to be unique within a parent.
- Use unique indexes for business invariants; do not rely on application checks alone when SQLite can enforce the rule locally.
- Centralize status and stage values in shared constants, while retaining SQL checks because TypeScript enums do not constrain stored data.
- Use consistent timestamp storage and defaults. Terminal timestamps describe completion, not ordering.
- Add a format version only when incompatible persisted formats must coexist. Never change the meaning of an existing version.
- Export every new table from `index.ts` and define the corresponding Drizzle relations in `relations.ts`.
- Give multiple relations between the same tables explicit, matching `relationName` values.
- Use stable, descriptive names for tables, columns, indexes, and constraints so migrations and integrity failures are diagnosable.
- Comment deliberate omissions and non-obvious constraints or deletion policies; do not narrate obvious column definitions.
- Generate and review a Drizzle migration for every schema change, apply it to the development database, and regenerate `schema.dbml`.
- Treat DBML as documentation rather than the source of truth. Preserve comments for checks, partial indexes, or other SQLite behavior DBML cannot represent.
- When existing databases must be preserved, test migrations from the prior schema rather than only fresh creation. For an explicitly approved destructive baseline reset, test the complete fresh baseline instead. In both cases, validate SQLite foreign keys and integrity afterward.
- Keep automated tests on the in-memory database and real migration chain; do not let tests mutate the committed development database.
