import { sql } from "drizzle-orm"
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { deepSearchJobs } from "./deepSearchJobs.ts"
import { deepSearchQueries } from "./deepSearchQueries.ts"
import { llmGenerations } from "./llmGenerations.ts"
import {
  deepSearchResultSelectionStatuses,
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
    status: text("status", { enum: deepSearchWebPageStatuses })
      .notNull()
      .default("pending"),
    summaryGenerationId: text("summary_generation_id").references(
      () => llmGenerations.llmGenerationId,
      { onDelete: "restrict" },
    ),
    errorStage: text("error_stage", {
      enum: deepSearchWebPageErrorStages,
    }),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("deep_search_web_pages_job_url_idx").on(
      table.deepSearchJobId,
      table.url,
    ),
    check(
      "deep_search_web_pages_status_check",
      sql`${table.status} in ('pending', 'extracting', 'summarizing', 'completed', 'failed')`,
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
    selectionStatus: text("selection_status", {
      enum: deepSearchResultSelectionStatuses,
    })
      .notNull()
      .default("pending"),
    deepSearchWebPageId: text("deep_search_web_page_id").references(
      () => deepSearchWebPages.deepSearchWebPageId,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("deep_search_results_query_position_idx").on(
      table.deepSearchQueryId,
      table.position,
    ),
    check("deep_search_results_position_check", sql`${table.position} >= 0`),
    check(
      "deep_search_results_selection_status_check",
      sql`${table.selectionStatus} in ('pending', 'selected', 'rejected')`,
    ),
  ],
)
