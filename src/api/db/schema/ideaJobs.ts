import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { llmGenerations } from "./llmGenerations.ts"
import { ideaJobStages, jobStatuses } from "./statuses.ts"

/** One durable idea-generation pipeline initiated from a user's prompt. */
export const ideaJobs = sqliteTable(
  "idea_jobs",
  {
    ideaJobId: text("idea_job_id").primaryKey(),
    prompt: text("prompt").notNull(),
    stage: text("stage", { enum: ideaJobStages })
      .notNull()
      .default("planning"),
    numberOfIdeas: integer("number_of_ideas").notNull(),
    deepSearchCount: integer("deep_search_count").notNull(),
    researchPromptGenerationId: text("research_prompt_generation_id")
      .unique()
      .references(() => llmGenerations.llmGenerationId, {
        onDelete: "restrict",
      }),
    researchSummaryGenerationId: text("research_summary_generation_id")
      .unique()
      .references(() => llmGenerations.llmGenerationId, {
        onDelete: "restrict",
      }),
    ideaGenerationId: text("idea_generation_id")
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
    index("idea_jobs_created_at_idx").on(table.createdAt),
    check(
      "idea_jobs_limits_check",
      sql`${table.numberOfIdeas} > 0 and ${table.deepSearchCount} > 0`,
    ),
    check(
      "idea_jobs_stage_check",
      sql`${table.stage} in ('planning', 'research', 'summary', 'ideas')`,
    ),
    check(
      "idea_jobs_status_check",
      sql`${table.status} in ('running', 'completed', 'failed', 'interrupted')`,
    ),
    check(
      "idea_jobs_terminal_fields_check",
      sql`(
        (${table.status} = 'running' and ${table.completedAt} is null and ${table.error} is null)
        or
        (${table.status} = 'completed' and ${table.completedAt} is not null and ${table.error} is null and ${table.researchPromptGenerationId} is not null and ${table.researchSummaryGenerationId} is not null and ${table.ideaGenerationId} is not null)
        or
        (${table.status} in ('failed', 'interrupted') and ${table.completedAt} is not null and ${table.error} is not null)
      )`,
    ),
  ],
)
