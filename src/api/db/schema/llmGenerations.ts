import { sql } from "drizzle-orm"
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { llmGenerationStatuses } from "./statuses.ts"

/** One model invocation, updated once with its terminal output. */
export const llmGenerations = sqliteTable(
  "llm_generations",
  {
    llmGenerationId: text("llm_generation_id").primaryKey(),
    status: text("status", { enum: llmGenerationStatuses })
      .notNull()
      .default("running"),
    text: text("text"),
    reasoning: text("reasoning"),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
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
        (${table.status} = 'completed' and ${table.text} is not null and ${table.reasoning} is not null and ${table.completedAt} is not null and ${table.error} is null)
        or
        (${table.status} in ('failed', 'interrupted') and ${table.completedAt} is not null and ${table.error} is not null)
      )`,
    ),
  ],
)
