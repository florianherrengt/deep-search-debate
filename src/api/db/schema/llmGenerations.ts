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

import { llmGenerationStatuses } from "./statuses.ts"
import { user } from "./auth.ts"
import { getDebateJobOwnerColumns } from "./debateJobs.ts"
import { getDeepSearchJobOwnerColumns } from "./deepSearchJobs.ts"
import { getIdeaJobOwnerColumns } from "./ideaJobs.ts"

/** One standalone or job-owned model invocation and its terminal output. */
export const llmGenerations = sqliteTable(
  "llm_generations",
  {
    llmGenerationId: text("llm_generation_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    debateJobId: text("debate_job_id"),
    ideaJobId: text("idea_job_id"),
    deepSearchJobId: text("deep_search_job_id"),
    status: text("status", { enum: llmGenerationStatuses })
      .notNull()
      .default("running"),
    text: text("text"),
    reasoning: text("reasoning"),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("llm_generations_user_started_at_idx").on(
      table.userId,
      table.startedAt,
      table.llmGenerationId,
    ),
    uniqueIndex("llm_generations_id_user_idea_job_idx").on(
      table.llmGenerationId,
      table.userId,
      table.ideaJobId,
    ),
    uniqueIndex("llm_generations_id_user_deep_search_job_idx").on(
      table.llmGenerationId,
      table.userId,
      table.deepSearchJobId,
    ),
    index("llm_generations_debate_job_id_idx").on(table.debateJobId),
    index("llm_generations_idea_job_id_idx").on(table.ideaJobId),
    index("llm_generations_deep_search_job_id_idx").on(
      table.deepSearchJobId,
    ),
    foreignKey({
      name: "llm_generations_debate_job_owner_fk",
      columns: [table.debateJobId, table.userId],
      foreignColumns: getDebateJobOwnerColumns(),
    }).onDelete("cascade"),
    foreignKey({
      name: "llm_generations_idea_job_owner_fk",
      columns: [table.ideaJobId, table.userId],
      foreignColumns: getIdeaJobOwnerColumns(),
    }).onDelete("cascade"),
    foreignKey({
      name: "llm_generations_deep_search_job_owner_fk",
      columns: [table.deepSearchJobId, table.userId],
      foreignColumns: getDeepSearchJobOwnerColumns(),
    }).onDelete("cascade"),
    check(
      "llm_generations_at_most_one_job_owner_check",
      sql`(
        (${table.debateJobId} is not null)
        + (${table.ideaJobId} is not null)
        + (${table.deepSearchJobId} is not null)
      ) <= 1`,
    ),
    check(
      "llm_generations_status_check",
      sql`${table.status} in ('running', 'completed', 'failed', 'interrupted')`,
    ),
    check(
      "llm_generations_output_fields_check",
      sql`(
        (${table.text} is null and ${table.reasoning} is null)
        or
        (${table.text} is not null and ${table.reasoning} is not null)
      )`,
    ),
    check(
      "llm_generations_terminal_fields_check",
      sql`(
        (${table.status} = 'running' and ${table.text} is null and ${table.reasoning} is null and ${table.completedAt} is null and ${table.error} is null)
        or
        (${table.status} = 'completed' and ${table.text} is not null and length(trim(${table.text}, char(9) || char(10) || char(11) || char(12) || char(13) || char(32))) > 0 and ${table.reasoning} is not null and ${table.completedAt} is not null and ${table.error} is null)
        or
        (${table.status} in ('failed', 'interrupted') and ${table.completedAt} is not null and ${table.error} is not null)
      )`,
    ),
  ],
)

/** Breaks schema-module cycles while retaining real generation foreign keys. */
export function getLlmGenerationIdColumn(): AnySQLiteColumn {
  return llmGenerations.llmGenerationId
}

export function getLlmGenerationIdeaOwnerColumns(): [
  AnySQLiteColumn,
  AnySQLiteColumn,
  AnySQLiteColumn,
] {
  return [
    llmGenerations.llmGenerationId,
    llmGenerations.userId,
    llmGenerations.ideaJobId,
  ]
}

export function getLlmGenerationDeepSearchOwnerColumns(): [
  AnySQLiteColumn,
  AnySQLiteColumn,
  AnySQLiteColumn,
] {
  return [
    llmGenerations.llmGenerationId,
    llmGenerations.userId,
    llmGenerations.deepSearchJobId,
  ]
}
