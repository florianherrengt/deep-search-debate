import { relations, sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const deepSearchJobStatuses = [
  "running",
  "completed",
  "failed",
  "interrupted",
] as const

export const llmGenerationStatuses = [
  "running",
  "completed",
  "failed",
  "interrupted",
] as const

export const deepSearchQueryStatuses = [
  "pending",
  "searching",
  "selecting",
  "summarizing",
  "completed",
  "failed",
] as const

export const deepSearchQueryErrorStages = [
  "search",
  "selection",
  "summary",
] as const

export const deepSearchResultSelectionStatuses = [
  "pending",
  "selected",
  "rejected",
] as const

export const deepSearchWebPageStatuses = [
  "pending",
  "extracting",
  "summarizing",
  "completed",
  "failed",
] as const

export const deepSearchWebPageErrorStages = ["extraction", "summary"] as const

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

/** One user- or system-initiated deep-search execution. */
export const deepSearchJobs = sqliteTable(
  "deep_search_jobs",
  {
    deepSearchJobId: text("deep_search_job_id").primaryKey(),
    researchRequest: text("research_request").notNull(),
    maxSearches: integer("max_searches").notNull(),
    maxResultsPerSearch: integer("max_results_per_search").notNull(),
    status: text("status", { enum: deepSearchJobStatuses })
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
        () =>
          deepSearchQueryGenerations.deepSearchQueryGenerationId,
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

export const deepSearchJobsRelations = relations(
  deepSearchJobs,
  ({ many, one }) => ({
    queryGeneration: one(deepSearchQueryGenerations),
    webPages: many(deepSearchWebPages),
  }),
)

export const deepSearchQueryGenerationsRelations = relations(
  deepSearchQueryGenerations,
  ({ many, one }) => ({
    job: one(deepSearchJobs, {
      fields: [deepSearchQueryGenerations.deepSearchJobId],
      references: [deepSearchJobs.deepSearchJobId],
    }),
    llmGeneration: one(llmGenerations, {
      fields: [deepSearchQueryGenerations.llmGenerationId],
      references: [llmGenerations.llmGenerationId],
    }),
    generatedQueries: many(deepSearchGeneratedQueries),
  }),
)

export const deepSearchGeneratedQueriesRelations = relations(
  deepSearchGeneratedQueries,
  ({ one }) => ({
    queryGeneration: one(deepSearchQueryGenerations, {
      fields: [deepSearchGeneratedQueries.deepSearchQueryGenerationId],
      references: [
        deepSearchQueryGenerations.deepSearchQueryGenerationId,
      ],
    }),
    execution: one(deepSearchQueries),
  }),
)

export const deepSearchQueriesRelations = relations(
  deepSearchQueries,
  ({ many, one }) => ({
    generatedQuery: one(deepSearchGeneratedQueries, {
      fields: [deepSearchQueries.deepSearchGeneratedQueryId],
      references: [deepSearchGeneratedQueries.deepSearchGeneratedQueryId],
    }),
    selectionGeneration: one(llmGenerations, {
      fields: [deepSearchQueries.selectionGenerationId],
      references: [llmGenerations.llmGenerationId],
      relationName: "deepSearchQuerySelectionGeneration",
    }),
    summaryGeneration: one(llmGenerations, {
      fields: [deepSearchQueries.summaryGenerationId],
      references: [llmGenerations.llmGenerationId],
      relationName: "deepSearchQuerySummaryGeneration",
    }),
    results: many(deepSearchResults),
  }),
)

export const deepSearchWebPagesRelations = relations(
  deepSearchWebPages,
  ({ many, one }) => ({
    job: one(deepSearchJobs, {
      fields: [deepSearchWebPages.deepSearchJobId],
      references: [deepSearchJobs.deepSearchJobId],
    }),
    summaryGeneration: one(llmGenerations, {
      fields: [deepSearchWebPages.summaryGenerationId],
      references: [llmGenerations.llmGenerationId],
    }),
    results: many(deepSearchResults),
  }),
)

export const deepSearchResultsRelations = relations(
  deepSearchResults,
  ({ one }) => ({
    query: one(deepSearchQueries, {
      fields: [deepSearchResults.deepSearchQueryId],
      references: [deepSearchQueries.deepSearchQueryId],
    }),
    webPage: one(deepSearchWebPages, {
      fields: [deepSearchResults.deepSearchWebPageId],
      references: [deepSearchWebPages.deepSearchWebPageId],
    }),
  }),
)
