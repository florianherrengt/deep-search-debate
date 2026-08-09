import { sql } from "drizzle-orm"
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { ideaJobs } from "./ideaJobs.ts"
import { getLlmGenerationIdColumn } from "./llmGenerations.ts"

/**
 * One stable idea produced by an idea-generation job. Ideas are normalized so
 * tournament rows reference durable IDs instead of brittle JSON array offsets.
 * position preserves generation order as metadata, not identity. Idea rows are
 * immutable after insertion except for its one-time critique link and
 * selection decision, so replay sees exactly what debate agents saw. Nullable
 * fields represent the valid intervals before those pipeline stages finish.
 */
export const ideas = sqliteTable(
  "ideas",
  {
    ideaId: text("idea_id").primaryKey(),
    ideaJobId: text("idea_job_id")
      .notNull()
      .references(() => ideaJobs.ideaJobId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    // Nullable until critique starts. The one-time SQL guard intentionally does
    // not couple this attachment to the parent job's terminal status.
    critiqueGenerationId: text("critique_generation_id")
      .unique()
      .references(getLlmGenerationIdColumn, { onDelete: "no action" }),
    // Null means selection has not completed. Every idea is atomically resolved
    // to true or false when the selector generation completes.
    selected: integer("selected", { mode: "boolean" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    uniqueIndex("ideas_job_position_idx").on(table.ideaJobId, table.position),
    check("ideas_position_check", sql`${table.position} >= 0`),
    check(
      "ideas_content_check",
      sql`length(trim(${table.title})) > 0 and length(trim(${table.description})) > 0`,
    ),
  ],
)
