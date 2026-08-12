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
import { deepSearchQueries } from "./deepSearchQueries.ts"
import { llmGenerations } from "./llmGenerations.ts"
import {
  deepSearchWebPageErrorStages,
  deepSearchWebPageStatuses,
} from "./statuses.ts"

/** One unique selected URL explored by a deep-search job. */
export const deepSearchWebPages = sqliteTable(
  "deep_search_web_pages",
  {
    deepSearchWebPageId: text("deep_search_web_page_id").primaryKey(),
    deepSearchJobId: text("deep_search_job_id")
      .notNull()
      .references(() => deepSearchJobs.deepSearchJobId, {
        onDelete: "cascade",
      }),
    url: text("url").notNull(),
    creditsUsed: integer("credits_used"),
    status: text("status", { enum: deepSearchWebPageStatuses })
      .notNull()
      .default("pending"),
    summaryGenerationId: text("summary_generation_id").references(
      () => llmGenerations.llmGenerationId,
      { onDelete: "no action" },
    ),
    errorStage: text("error_stage", {
      enum: deepSearchWebPageErrorStages,
    }),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("deep_search_web_pages_job_url_idx").on(
      table.deepSearchJobId,
      table.url,
    ),
    index("deep_search_web_pages_summary_generation_id_idx").on(
      table.summaryGenerationId,
    ),
    check(
      "deep_search_web_pages_status_check",
      sql`${table.status} in ('pending', 'extracting', 'summarizing', 'completed', 'failed')`,
    ),
    check(
      "deep_search_web_pages_url_content_check",
      sql`length(trim(${table.url})) > 0`,
    ),
    check(
      "deep_search_web_pages_error_stage_check",
      sql`${table.errorStage} is null or ${table.errorStage} in ('extraction', 'summary')`,
    ),
    check(
      "deep_search_web_pages_error_fields_check",
      sql`(
        (${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.errorStage} is not null and ${table.errorMessage} is not null)
      )`,
    ),
    check(
      "deep_search_web_pages_lifecycle_check",
      sql`(
        (${table.status} in ('pending', 'extracting') and ${table.summaryGenerationId} is null and ${table.completedAt} is null and ${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.status} = 'summarizing' and ${table.summaryGenerationId} is not null and ${table.completedAt} is null and ${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.status} = 'completed' and ${table.summaryGenerationId} is not null and ${table.completedAt} is not null and ${table.errorStage} is null and ${table.errorMessage} is null)
        or
        (${table.status} = 'failed' and ${table.completedAt} is not null and ${table.errorStage} is not null and ${table.errorMessage} is not null and (${table.errorStage} = 'summary' or ${table.summaryGenerationId} is null))
      )`,
    ),
  ],
)

/** One ordered SearXNG result belonging to a generated query. */
export const deepSearchResults = sqliteTable(
  "deep_search_results",
  {
    deepSearchResultId: text("deep_search_result_id").primaryKey(),
    deepSearchQueryId: text("deep_search_query_id")
      .notNull()
      .references(() => deepSearchQueries.deepSearchQueryId, {
        onDelete: "cascade",
      }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    shortText: text("short_text").notNull(),
    url: text("url").notNull(),
    /** Non-null exactly when the selector chose this result for exploration. */
    selectedWebPageId: text("selected_web_page_id").references(
      () => deepSearchWebPages.deepSearchWebPageId,
      // Block partial page deletion while allowing a root-job cascade to
      // remove both the result and page before the statement is checked.
      { onDelete: "no action" },
    ),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    uniqueIndex("deep_search_results_query_position_idx").on(
      table.deepSearchQueryId,
      table.position,
    ),
    index("deep_search_results_selected_web_page_id_idx").on(
      table.selectedWebPageId,
    ),
    check("deep_search_results_position_check", sql`${table.position} >= 0`),
    check(
      "deep_search_results_content_check",
      sql`length(trim(${table.title})) > 0 and length(trim(${table.shortText})) > 0 and length(trim(${table.url})) > 0`,
    ),
  ],
)
