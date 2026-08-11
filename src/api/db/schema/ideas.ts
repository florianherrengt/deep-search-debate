import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { ideaJobs } from "./ideaJobs.ts"
import {
  getLlmGenerationIdeaColumns,
} from "./llmGenerations.ts"

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
    critiqueGenerationId: text("critique_generation_id").unique(),
    // Null means selection has not completed. Every idea is atomically resolved
    // to true or false when the selector generation completes.
    selected: integer("selected", { mode: "boolean" }),
    // Selected ideas are refined once. The generation link is attached when
    // refinement starts; validated output is written atomically on completion.
    refinementGenerationId: text("refinement_generation_id").unique(),
    refinedTitle: text("refined_title"),
    refinedDescription: text("refined_description"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    uniqueIndex("ideas_job_position_idx").on(table.ideaJobId, table.position),
    foreignKey({
      name: "ideas_critique_generation_owner_fk",
      columns: [table.critiqueGenerationId, table.ideaJobId],
      foreignColumns: getLlmGenerationIdeaColumns(),
    }).onDelete("no action"),
    foreignKey({
      name: "ideas_refinement_generation_owner_fk",
      columns: [table.refinementGenerationId, table.ideaJobId],
      foreignColumns: getLlmGenerationIdeaColumns(),
    }).onDelete("no action"),
    check("ideas_position_check", sql`${table.position} >= 0`),
    check(
      "ideas_content_check",
      sql`length(trim(${table.title})) > 0 and length(trim(${table.description})) > 0`,
    ),
    check(
      "ideas_refinement_lifecycle_check",
      sql`(
        (${table.refinementGenerationId} is null and ${table.refinedTitle} is null and ${table.refinedDescription} is null)
        or
        (${table.selected} = 1 and ${table.refinementGenerationId} is not null and (
          (${table.refinedTitle} is null and ${table.refinedDescription} is null)
          or
          (${table.refinedTitle} is not null and length(trim(${table.refinedTitle})) > 0 and ${table.refinedDescription} is not null and length(trim(${table.refinedDescription})) > 0)
        ))
      )`,
    ),
  ],
)
