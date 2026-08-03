import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { ideaJobs } from "./ideaJobs.ts"
import { llmGenerations } from "./llmGenerations.ts"
import { jobStatuses } from "./statuses.ts"

/** One user- or system-initiated deep-search execution. */
export const deepSearchJobs = sqliteTable(
  "deep_search_jobs",
  {
    deepSearchJobId: text("deep_search_job_id").primaryKey(),
    ideaJobId: text("idea_job_id").references(() => ideaJobs.ideaJobId, {
      onDelete: "cascade",
    }),
    researchRequest: text("research_request").notNull(),
    maxSearches: integer("max_searches").notNull(),
    maxResultsPerSearch: integer("max_results_per_search").notNull(),
    finalAnswerGenerationId: text("final_answer_generation_id")
      .unique()
      .references(() => llmGenerations.llmGenerationId, {
        onDelete: "restrict",
      }),
    status: text("status", { enum: jobStatuses })
      .notNull()
      .default("running"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    index("deep_search_jobs_created_at_idx").on(table.createdAt),
    index("deep_search_jobs_idea_job_created_at_idx").on(
      table.ideaJobId,
      table.createdAt,
    ),
    check(
      "deep_search_jobs_limits_check",
      sql`${table.maxSearches} > 0 and ${table.maxResultsPerSearch} > 0`,
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
        (${table.status} = 'completed' and ${table.completedAt} is not null and ${table.error} is null)
        or
        (${table.status} in ('failed', 'interrupted') and ${table.completedAt} is not null and ${table.error} is not null)
      )`,
    ),
  ],
)
