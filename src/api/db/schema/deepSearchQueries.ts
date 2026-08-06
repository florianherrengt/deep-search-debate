import { sql } from "drizzle-orm"
import {
  check,
  index,
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
        onDelete: "no action",
      }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
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
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
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
    check(
      "deep_search_generated_queries_content_check",
      sql`length(trim(${table.query})) > 0`,
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
      { onDelete: "no action" },
    ),
    summaryGenerationId: text("summary_generation_id").references(
      () => llmGenerations.llmGenerationId,
      { onDelete: "no action" },
    ),
    errorStage: text("error_stage", {
      enum: deepSearchQueryErrorStages,
    }),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("deep_search_queries_selection_generation_id_idx").on(
      table.selectionGenerationId,
    ),
    index("deep_search_queries_summary_generation_id_idx").on(
      table.summaryGenerationId,
    ),
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
    check(
      "deep_search_queries_lifecycle_check",
      sql`(
        (${table.status} in ('pending', 'searching') and ${table.selectionGenerationId} is null and ${table.summaryGenerationId} is null and ${table.completedAt} is null and ${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.status} = 'selecting' and ${table.summaryGenerationId} is null and ${table.completedAt} is null and ${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.status} = 'summarizing' and ${table.selectionGenerationId} is not null and ${table.completedAt} is null and ${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.status} = 'completed' and ${table.selectionGenerationId} is not null and ${table.summaryGenerationId} is not null and ${table.completedAt} is not null and ${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.status} = 'failed' and ${table.completedAt} is not null and ${table.errorStage} is not null and ${table.errorMessage} is not null and (
          (${table.errorStage} = 'search' and ${table.selectionGenerationId} is null and ${table.summaryGenerationId} is null)
          or
          (${table.errorStage} = 'selection' and ${table.summaryGenerationId} is null)
          or
          (${table.errorStage} = 'summary' and ${table.selectionGenerationId} is not null)
        ))
      )`,
    ),
  ],
)
