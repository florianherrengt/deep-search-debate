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

export const deepSearchRoundReviewDecisions = ["continue", "stop"] as const

/** One ordered search round, its query-plan generation, and continuation review. */
export const deepSearchRounds = sqliteTable(
  "deep_search_rounds",
  {
    deepSearchRoundId: text("deep_search_round_id").primaryKey(),
    deepSearchJobId: text("deep_search_job_id")
      .notNull()
      .references(() => deepSearchJobs.deepSearchJobId, {
        onDelete: "cascade",
      }),
    position: integer("position").notNull().default(0),
    llmGenerationId: text("llm_generation_id")
      .notNull()
      .unique()
      .references(() => llmGenerations.llmGenerationId, {
        onDelete: "no action",
      }),
    answerGenerationId: text("answer_generation_id")
      .unique()
      .references(() => llmGenerations.llmGenerationId, {
        onDelete: "no action",
      }),
    reviewGenerationId: text("review_generation_id")
      .unique()
      .references(() => llmGenerations.llmGenerationId, {
        onDelete: "no action",
      }),
    reviewDecision: text("review_decision", {
      enum: deepSearchRoundReviewDecisions,
    }),
    reviewReason: text("review_reason"),
    reviewError: text("review_error"),
    reviewCompletedAt: integer("review_completed_at", {
      mode: "timestamp_ms",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    uniqueIndex("deep_search_rounds_job_position_idx").on(
      table.deepSearchJobId,
      table.position,
    ),
    check(
      "deep_search_rounds_position_check",
      sql`${table.position} >= 0`,
    ),
    check(
      "deep_search_rounds_review_decision_check",
      sql`${table.reviewDecision} is null or ${table.reviewDecision} in ('continue', 'stop')`,
    ),
    check(
      "deep_search_rounds_review_lifecycle_check",
      sql`(
        (${table.reviewGenerationId} is null and ${table.reviewDecision} is null and ${table.reviewReason} is null and ${table.reviewError} is null and ${table.reviewCompletedAt} is null)
        or
        (${table.reviewGenerationId} is not null and ${table.reviewDecision} is null and ${table.reviewReason} is null and ${table.reviewError} is null and ${table.reviewCompletedAt} is null)
        or
        (${table.reviewGenerationId} is not null and ${table.reviewDecision} is not null and ${table.reviewReason} is not null and ${table.reviewError} is null and ${table.reviewCompletedAt} is not null)
        or
        (${table.reviewDecision} is null and ${table.reviewReason} is null and ${table.reviewError} is not null and ${table.reviewCompletedAt} is not null)
      )`,
    ),
  ],
)

/** One ordered planned query and its complete execution lifecycle. */
export const deepSearchQueries = sqliteTable(
  "deep_search_queries",
  {
    deepSearchQueryId: text("deep_search_query_id").primaryKey(),
    deepSearchRoundId: text("deep_search_round_id")
      .notNull()
      .references(() => deepSearchRounds.deepSearchRoundId, {
        onDelete: "cascade",
      }),
    position: integer("position").notNull(),
    query: text("query").notNull(),
    status: text("status", { enum: deepSearchQueryStatuses })
      .notNull()
      .default("searching"),
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
    uniqueIndex("deep_search_queries_round_position_idx").on(
      table.deepSearchRoundId,
      table.position,
    ),
    index("deep_search_queries_selection_generation_id_idx").on(
      table.selectionGenerationId,
    ),
    index("deep_search_queries_summary_generation_id_idx").on(
      table.summaryGenerationId,
    ),
    check(
      "deep_search_queries_status_check",
      sql`${table.status} in ('searching', 'selecting', 'summarizing', 'completed', 'failed')`,
    ),
    check("deep_search_queries_position_check", sql`${table.position} >= 0`),
    check(
      "deep_search_queries_content_check",
      sql`length(trim(${table.query})) > 0`,
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
        (${table.status} = 'searching' and ${table.selectionGenerationId} is null and ${table.summaryGenerationId} is null and ${table.completedAt} is null and ${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.status} = 'selecting' and ${table.summaryGenerationId} is null and ${table.completedAt} is null and ${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.status} = 'summarizing' and ${table.selectionGenerationId} is not null and ${table.completedAt} is null and ${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.status} = 'completed' and ${table.completedAt} is not null and ${table.errorStage} is null and ${table.errorMessage} is null and (
          (${table.selectionGenerationId} is not null and ${table.summaryGenerationId} is not null)
          or
          (${table.selectionGenerationId} is null and ${table.summaryGenerationId} is null)
        ))
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
