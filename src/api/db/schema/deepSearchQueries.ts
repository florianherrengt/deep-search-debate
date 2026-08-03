import { sql } from "drizzle-orm"
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { deepSearchJobs } from "./deepSearchJobs.ts"
import { llmGenerations } from "./llmGenerations.ts"
import {
  deepSearchQueryErrorStages,
  deepSearchQueryStatuses,
} from "./statuses.ts"

/** The model invocation that produced one job's prioritized query list. */
export const deepSearchQueryGenerations = sqliteTable(
  "deep_search_query_generations",
  {
    deepSearchQueryGenerationId: text(
      "deep_search_query_generation_id",
    ).primaryKey(),
    deepSearchJobId: text("deep_search_job_id")
      .notNull()
      .unique()
      .references(() => deepSearchJobs.deepSearchJobId, {
        onDelete: "cascade",
      }),
    llmGenerationId: text("llm_generation_id")
      .notNull()
      .unique()
      .references(() => llmGenerations.llmGenerationId, {
        onDelete: "restrict",
      }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
)

/** One ordered query parsed from the query-generation model output. */
export const deepSearchGeneratedQueries = sqliteTable(
  "deep_search_generated_queries",
  {
    deepSearchGeneratedQueryId: text(
      "deep_search_generated_query_id",
    ).primaryKey(),
    deepSearchQueryGenerationId: text("deep_search_query_generation_id")
      .notNull()
      .references(
        () => deepSearchQueryGenerations.deepSearchQueryGenerationId,
        { onDelete: "cascade" },
      ),
    position: integer("position").notNull(),
    query: text("query").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("deep_search_generated_queries_generation_position_idx").on(
      table.deepSearchQueryGenerationId,
      table.position,
    ),
    check(
      "deep_search_generated_queries_position_check",
      sql`${table.position} >= 0`,
    ),
  ],
)

/** One generated query selected for actual web-search execution. */
export const deepSearchQueries = sqliteTable(
  "deep_search_queries",
  {
    deepSearchQueryId: text("deep_search_query_id").primaryKey(),
    deepSearchGeneratedQueryId: text("deep_search_generated_query_id")
      .notNull()
      .unique()
      .references(() => deepSearchGeneratedQueries.deepSearchGeneratedQueryId, {
        onDelete: "cascade",
      }),
    status: text("status", { enum: deepSearchQueryStatuses })
      .notNull()
      .default("pending"),
    selectionGenerationId: text("selection_generation_id").references(
      () => llmGenerations.llmGenerationId,
      { onDelete: "restrict" },
    ),
    summaryGenerationId: text("summary_generation_id").references(
      () => llmGenerations.llmGenerationId,
      { onDelete: "restrict" },
    ),
    errorStage: text("error_stage", {
      enum: deepSearchQueryErrorStages,
    }),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    check(
      "deep_search_queries_status_check",
      sql`${table.status} in ('pending', 'searching', 'selecting', 'summarizing', 'completed', 'failed')`,
    ),
    check(
      "deep_search_queries_error_stage_check",
      sql`${table.errorStage} is null or ${table.errorStage} in ('search', 'selection', 'summary')`,
    ),
    check(
      "deep_search_queries_error_fields_check",
      sql`(
        (${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.errorStage} is not null and ${table.errorMessage} is not null)
      )`,
    ),
  ],
)
