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

import { getDebateJobOwnerColumns } from "./debateJobs.ts"
import {
  getLlmGenerationIdeaOwnerColumns,
} from "./llmGenerations.ts"
import { ideaJobStages, jobStatuses } from "./statuses.ts"
import { user } from "./auth.ts"

/** A standalone or debate-owned durable idea-generation pipeline. */
export const ideaJobs = sqliteTable(
  "idea_jobs",
  {
    ideaJobId: text("idea_job_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    debateJobId: text("debate_job_id").unique(),
    title: text("title").notNull().default("Untitled"),
    slug: text("slug").notNull().default("untitled"),
    prompt: text("prompt").notNull(),
    stage: text("stage", { enum: ideaJobStages })
      .notNull()
      .default("planning"),
    numberOfIdeas: integer("number_of_ideas").notNull(),
    deepSearchCount: integer("deep_search_count").notNull(),
    researchPromptGenerationId: text(
      "research_prompt_generation_id",
    ).unique(),
    researchSummaryGenerationId: text(
      "research_summary_generation_id",
    ).unique(),
    ideaGenerationId: text("idea_generation_id").unique(),
    selectionGenerationId: text("selection_generation_id").unique(),
    status: text("status", { enum: jobStatuses })
      .notNull()
      .default("running"),
    feedbackRating: integer("feedback_rating", { mode: "boolean" }),
    feedbackText: text("feedback_text"),
    error: text("error"),
    /** Set only on a standalone root when its owner requests an irreversible stop. */
    cancelRequestedAt: integer("cancel_requested_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("idea_jobs_user_created_at_idx").on(
      table.userId,
      table.createdAt,
      table.ideaJobId,
    ),
    uniqueIndex("idea_jobs_slug_idx").on(table.slug),
    uniqueIndex("idea_jobs_id_user_id_idx").on(
      table.ideaJobId,
      table.userId,
    ),
    foreignKey({
      name: "idea_jobs_debate_job_owner_fk",
      columns: [table.debateJobId, table.userId],
      foreignColumns: getDebateJobOwnerColumns(),
    }).onDelete("cascade"),
    foreignKey({
      name: "idea_jobs_research_prompt_generation_owner_fk",
      columns: [
        table.researchPromptGenerationId,
        table.userId,
        table.ideaJobId,
      ],
      foreignColumns: getLlmGenerationIdeaOwnerColumns(),
    }).onDelete("no action"),
    foreignKey({
      name: "idea_jobs_research_summary_generation_owner_fk",
      columns: [
        table.researchSummaryGenerationId,
        table.userId,
        table.ideaJobId,
      ],
      foreignColumns: getLlmGenerationIdeaOwnerColumns(),
    }).onDelete("no action"),
    foreignKey({
      name: "idea_jobs_idea_generation_owner_fk",
      columns: [table.ideaGenerationId, table.userId, table.ideaJobId],
      foreignColumns: getLlmGenerationIdeaOwnerColumns(),
    }).onDelete("no action"),
    foreignKey({
      name: "idea_jobs_selection_generation_owner_fk",
      columns: [table.selectionGenerationId, table.userId, table.ideaJobId],
      foreignColumns: getLlmGenerationIdeaOwnerColumns(),
    }).onDelete("no action"),
    check(
      "idea_jobs_limits_check",
      sql`${table.numberOfIdeas} > 0 and ${table.deepSearchCount} > 0`,
    ),
    check(
      "idea_jobs_stage_check",
      sql`${table.stage} in ('planning', 'research', 'summary', 'ideas')`,
    ),
    // Stage-to-generation progression deliberately stays in runIdeaJob(). A
    // generation is linked while its stage is still active, and a failed or
    // interrupted job may retain any successfully persisted pipeline prefix.
    check(
      "idea_jobs_status_check",
      sql`${table.status} in ('running', 'completed', 'failed', 'interrupted')`,
    ),
    check(
      "idea_jobs_feedback_rating_check",
      sql`${table.feedbackRating} is null or (${table.status} = 'completed' and ${table.feedbackRating} in (0, 1))`,
    ),
    check(
      "idea_jobs_feedback_text_check",
      sql`${table.feedbackText} is null or (${table.status} = 'completed' and ${table.feedbackRating} is false and length(${table.feedbackText}) <= 5000 and length(trim(${table.feedbackText})) > 0)`,
    ),
    check(
      "idea_jobs_cancel_root_check",
      sql`${table.cancelRequestedAt} is null or ${table.debateJobId} is null`,
    ),
    check(
      "idea_jobs_prompt_content_check",
      sql`length(trim(${table.prompt})) > 0`,
    ),
    check(
      "idea_jobs_terminal_fields_check",
      sql`(
        (${table.status} = 'running' and ${table.completedAt} is null and ${table.error} is null)
        or
        (${table.status} = 'completed' and ${table.stage} = 'ideas' and ${table.completedAt} is not null and ${table.error} is null and ${table.cancelRequestedAt} is null and ${table.researchPromptGenerationId} is not null and ${table.researchSummaryGenerationId} is not null and ${table.ideaGenerationId} is not null)
        or
        (${table.status} = 'failed' and ${table.completedAt} is not null and ${table.error} is not null and ${table.cancelRequestedAt} is null)
        or
        (${table.status} = 'interrupted' and ${table.completedAt} is not null and ${table.error} is not null)
      )`,
    ),
  ],
)

/** Lets owned-generation FKs target an idea job without an inference cycle. */
export function getIdeaJobOwnerColumns(): [
  AnySQLiteColumn,
  AnySQLiteColumn,
] {
  return [ideaJobs.ideaJobId, ideaJobs.userId]
}
