import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core"

import { ideaJobs } from "./ideaJobs.ts"
import { getLlmGenerationDeepSearchOwnerColumns } from "./llmGenerations.ts"
import { jobStatuses } from "./statuses.ts"
import { user } from "./auth.ts"

/** One user- or system-initiated deep-search execution. */
export const deepSearchJobs = sqliteTable(
  "deep_search_jobs",
  {
    deepSearchJobId: text("deep_search_job_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ideaJobId: text("idea_job_id"),
    /** Preserves the parent planning generation's research-request order. */
    ideaJobPosition: integer("idea_job_position"),
    title: text("title").notNull().default("Untitled"),
    slug: text("slug").notNull().default("untitled"),
    researchRequest: text("research_request").notNull(),
    maxSearches: integer("max_searches").notNull(),
    maxResultsPerSearch: integer("max_results_per_search").notNull(),
    finalAnswerGenerationId: text("final_answer_generation_id").unique(),
    status: text("status", { enum: jobStatuses })
      .notNull()
      .default("running"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("deep_search_jobs_user_created_at_idx").on(
      table.userId,
      table.createdAt,
      table.deepSearchJobId,
    ),
    uniqueIndex("deep_search_jobs_slug_idx").on(table.slug),
    uniqueIndex("deep_search_jobs_id_user_id_idx").on(
      table.deepSearchJobId,
      table.userId,
    ),
    uniqueIndex("deep_search_jobs_idea_job_position_idx").on(
      table.ideaJobId,
      table.ideaJobPosition,
    ),
    foreignKey({
      name: "deep_search_jobs_idea_job_owner_fk",
      columns: [table.ideaJobId, table.userId],
      foreignColumns: [ideaJobs.ideaJobId, ideaJobs.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "deep_search_jobs_final_answer_generation_owner_fk",
      columns: [
        table.finalAnswerGenerationId,
        table.userId,
        table.deepSearchJobId,
      ],
      foreignColumns: getLlmGenerationDeepSearchOwnerColumns(),
    }).onDelete("no action"),
    check(
      "deep_search_jobs_idea_job_position_check",
      sql`(
        (${table.ideaJobId} is null and ${table.ideaJobPosition} is null)
        or
        (${table.ideaJobId} is not null and ${table.ideaJobPosition} >= 0)
      )`,
    ),
    check(
      "deep_search_jobs_limits_check",
      sql`${table.maxSearches} > 0 and ${table.maxResultsPerSearch} > 0`,
    ),
    check(
      "deep_search_jobs_research_request_content_check",
      sql`length(trim(${table.researchRequest})) > 0`,
    ),
    check(
      "deep_search_jobs_status_check",
      sql`${table.status} in ('running', 'completed', 'failed', 'interrupted')`,
    ),
    check(
      "deep_search_jobs_terminal_fields_check",
      sql`(
        (${table.status} = 'running' and ${table.completedAt} is null and ${table.error} is null)
        or
        (${table.status} = 'completed' and ${table.finalAnswerGenerationId} is not null and ${table.completedAt} is not null and ${table.error} is null)
        or
        (${table.status} in ('failed', 'interrupted') and ${table.completedAt} is not null and ${table.error} is not null)
      )`,
    ),
  ],
)

/** Lets owned-generation FKs target a search without an inference cycle. */
export function getDeepSearchJobOwnerColumns(): [
  AnySQLiteColumn,
  AnySQLiteColumn,
] {
  return [deepSearchJobs.deepSearchJobId, deepSearchJobs.userId]
}
