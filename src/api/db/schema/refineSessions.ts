import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { getDeepSearchJobOwnerColumns } from "./deepSearchJobs.ts"
import { user } from "./auth.ts"
import { refineBatchStatuses, refineSessionStatuses } from "./statuses.ts"

function getRefineBatchOwnerColumns(): [AnySQLiteColumn, AnySQLiteColumn] {
  return [refineBatches.refineBatchId, refineBatches.refineSessionId]
}

/** Private, durable clarification sessions owned by one account. */
export const refineSessions = sqliteTable(
  "refine_sessions",
  {
    refineSessionId: text("refine_session_id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    originalPrompt: text("original_prompt").notNull(),
    status: text("status", { enum: refineSessionStatuses }).notNull().default("clarifying"),
    activeBatchId: text("active_batch_id"),
    finalDeepSearchJobId: text("final_deep_search_job_id").unique(),
    finalResearchRequest: text("final_research_request"),
    sharedStateRevision: integer("shared_state_revision").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    index("refine_sessions_user_updated_at_idx").on(table.userId, table.updatedAt, table.refineSessionId),
    uniqueIndex("refine_sessions_id_user_id_idx").on(table.refineSessionId, table.userId),
    foreignKey({
      name: "refine_sessions_active_batch_owner_fk",
      columns: [table.activeBatchId, table.refineSessionId],
      foreignColumns: getRefineBatchOwnerColumns(),
    }),
    check("refine_sessions_prompt_check", sql`length(trim(${table.originalPrompt})) > 0`),
    check("refine_sessions_status_check", sql`${table.status} in ('clarifying', 'starting', 'research-started')`),
    check("refine_sessions_revision_check", sql`${table.sharedStateRevision} >= 0`),
    check("refine_sessions_research_fields_check", sql`(
      (${table.status} = 'clarifying' and ${table.finalDeepSearchJobId} is null and ${table.finalResearchRequest} is null)
      or
      (${table.status} in ('starting', 'research-started') and ${table.finalDeepSearchJobId} is not null and ${table.finalResearchRequest} is not null)
    )`),
  ],
)

/** One immutable question batch or the current preparation checkpoint. */
export const refineBatches = sqliteTable(
  "refine_batches",
  {
    refineBatchId: text("refine_batch_id").primaryKey(),
    refineSessionId: text("refine_session_id").notNull().references(() => refineSessions.refineSessionId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    status: text("status", { enum: refineBatchStatuses }).notNull(),
    questions: text("questions").notNull().default("[]"),
    draftAnswers: text("draft_answers").notNull().default("[]"),
    answers: text("answers"),
    stageCheckpoints: text("stage_checkpoints").notNull().default("{}"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    uniqueIndex("refine_batches_session_position_idx").on(table.refineSessionId, table.position),
    uniqueIndex("refine_batches_id_session_id_idx").on(table.refineBatchId, table.refineSessionId),
    check("refine_batches_position_check", sql`${table.position} >= 0`),
    check("refine_batches_status_check", sql`${table.status} in ('preparing', 'ready', 'failed', 'submitted')`),
    check("refine_batches_terminal_fields_check", sql`(
      (${table.status} = 'failed' and ${table.error} is not null)
      or
      (${table.status} != 'failed' and ${table.error} is null)
    )`),
    check("refine_batches_answer_state_check", sql`(
      (${table.status} = 'submitted' and ${table.answers} is not null)
      or
      (${table.status} != 'submitted' and ${table.answers} is null)
    )`),
  ],
)

/** Append-only revisions retain prior decisions, needs, assumptions and provenance. */
export const refineStateRevisions = sqliteTable(
  "refine_state_revisions",
  {
    refineStateRevisionId: text("refine_state_revision_id").primaryKey(),
    refineSessionId: text("refine_session_id").notNull().references(() => refineSessions.refineSessionId, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    reason: text("reason").notNull(),
    state: text("state").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    uniqueIndex("refine_state_revisions_session_revision_idx").on(table.refineSessionId, table.revision),
    check("refine_state_revisions_revision_check", sql`${table.revision} > 0`),
  ],
)

/** Explicit ownership/origin link; preparation searches appear as Automated research. */
export const refineSearchLinks = sqliteTable(
  "refine_search_links",
  {
    refineSearchLinkId: text("refine_search_link_id").primaryKey(),
    refineSessionId: text("refine_session_id").notNull(),
    refineBatchId: text("refine_batch_id"),
    deepSearchJobId: text("deep_search_job_id").notNull().unique(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["preparation", "research"] }).notNull(),
    position: integer("position"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    index("refine_search_links_session_role_idx").on(table.refineSessionId, table.role),
    uniqueIndex("refine_search_links_preparation_idx").on(table.refineSessionId, table.refineBatchId, table.position).where(sql`${table.role} = 'preparation'`),
    uniqueIndex("refine_search_links_research_idx").on(table.refineSessionId).where(sql`${table.role} = 'research'`),
    foreignKey({
      name: "refine_search_links_session_owner_fk",
      columns: [table.refineSessionId, table.userId],
      foreignColumns: [refineSessions.refineSessionId, refineSessions.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "refine_search_links_batch_owner_fk",
      columns: [table.refineBatchId, table.refineSessionId],
      foreignColumns: getRefineBatchOwnerColumns(),
    }).onDelete("cascade"),
    foreignKey({
      name: "refine_search_links_deep_search_owner_fk",
      columns: [table.deepSearchJobId, table.userId],
      foreignColumns: getDeepSearchJobOwnerColumns(),
    }).onDelete("cascade"),
    check("refine_search_links_role_batch_check", sql`(
      (${table.role} = 'preparation' and ${table.refineBatchId} is not null and ${table.position} is not null and ${table.position} >= 0)
      or (${table.role} = 'research' and ${table.refineBatchId} is null and ${table.position} is null)
    )`),
  ],
)
