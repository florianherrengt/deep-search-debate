import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core"

import { ideas } from "./ideas.ts"
import { llmGenerations } from "./llmGenerations.ts"
import {
  debateJobStages,
  debateRoundStages,
  jobStatuses,
} from "./statuses.ts"
import { user } from "./auth.ts"

/**
 * Debate persistence deliberately stores facts, not projections:
 *
 * - One debate job owns one idea job and all of that job's ideas compete. The
 *   child idea_jobs row carries that ownership foreign key so deleting the
 *   debate cascades through the complete generated pipeline. There
 *   is no participant table because tournament membership adds no information.
 * - There is no format version while only one persisted format exists. Add one
 *   only when incompatible tournament formats must coexist in the database.
 * - Wins, Elo, standings, prior pairings, and knockout qualification are
 *   derived from completed matches instead of duplicated in snapshot tables.
 * - SQL constraints protect row-local invariants. The tournament transaction
 *   validates same-job ownership, one appearance per round, no repeat Swiss
 *   pairing, stage match counts, pairing rules, and stage transitions.
 */
export const debateJobs = sqliteTable(
  "debate_jobs",
  {
    debateJobId: text("debate_job_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Makes initial pairing and final tie-breaking reproducible. */
    randomSeed: integer("random_seed").notNull(),
    /** Public debates grant anonymous read access to this complete aggregate. */
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    stage: text("stage", { enum: debateJobStages })
      .notNull()
      .default("ideas"),
    status: text("status", { enum: jobStatuses })
      .notNull()
      .default("running"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("debate_jobs_user_created_at_idx").on(
      table.userId,
      table.createdAt,
      table.debateJobId,
    ),
    uniqueIndex("debate_jobs_id_user_id_idx").on(
      table.debateJobId,
      table.userId,
    ),
    check(
      "debate_jobs_config_check",
      sql`${table.randomSeed} >= 0 and ${table.randomSeed} <= 4294967295`,
    ),
    check(
      "debate_jobs_visibility_check",
      sql`${table.isPublic} in (0, 1)`,
    ),
    check(
      "debate_jobs_stage_check",
      sql`${table.stage} in ('ideas', 'swiss', 'semifinal', 'final')`,
    ),
    check(
      "debate_jobs_status_check",
      sql`${table.status} in ('running', 'completed', 'failed', 'interrupted')`,
    ),
    check(
      "debate_jobs_terminal_fields_check",
      sql`(
        (${table.status} = 'running' and ${table.completedAt} is null and ${table.error} is null)
        or
        (${table.status} = 'completed' and ${table.stage} = 'final' and ${table.completedAt} is not null and ${table.error} is null)
        or
        (${table.status} in ('failed', 'interrupted') and ${table.completedAt} is not null and ${table.error} is not null)
      )`,
    ),
  ],
)

/**
 * A structural grouping for matches. Progress is derived from match results.
 * There is no global sequence: tournament order is derived from stage
 * precedence and stageRoundNumber (Swiss 1-5, semifinal 1, final 1).
 */
export const debateRounds = sqliteTable(
  "debate_rounds",
  {
    debateRoundId: text("debate_round_id").primaryKey(),
    debateJobId: text("debate_job_id")
      .notNull()
      .references(() => debateJobs.debateJobId, { onDelete: "cascade" }),
    stage: text("stage", { enum: debateRoundStages }).notNull(),
    stageRoundNumber: integer("stage_round_number").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    uniqueIndex("debate_rounds_job_stage_number_idx").on(
      table.debateJobId,
      table.stage,
      table.stageRoundNumber,
    ),
    check(
      "debate_rounds_number_check",
      sql`${table.stageRoundNumber} > 0`,
    ),
    check(
      "debate_rounds_stage_check",
      sql`${table.stage} in ('swiss', 'semifinal', 'final') and (${table.stage} = 'swiss' or ${table.stageRoundNumber} = 1)`,
    ),
  ],
)

/**
 * One pairing. Idea columns are stored in randomized presentation order;
 * rankings are hidden from the judge. Matches reference ideas directly because
 * the idea job already defines the tournament's fixed membership.
 *
 * winnerIdeaId plus completedAt is the canonical machine-readable result. The
 * judge's explanation remains in its linked transcript generation, so standings
 * and recovery never depend on parsing model text.
 */
export const debateMatches = sqliteTable(
  "debate_matches",
  {
    debateMatchId: text("debate_match_id").primaryKey(),
    debateRoundId: text("debate_round_id")
      .notNull()
      .references(() => debateRounds.debateRoundId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    firstIdeaId: text("first_idea_id")
      .notNull()
      // NO ACTION protects direct idea deletion but, unlike RESTRICT, waits
      // until a parent idea-job cascade has removed the tournament matches.
      .references(() => ideas.ideaId, { onDelete: "no action" }),
    secondIdeaId: text("second_idea_id")
      .notNull()
      .references(() => ideas.ideaId, { onDelete: "no action" }),
    winnerIdeaId: text("winner_idea_id").references(() => ideas.ideaId, {
      onDelete: "no action",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("debate_matches_round_position_idx").on(
      table.debateRoundId,
      table.position,
    ),
    index("debate_matches_first_idea_id_idx").on(table.firstIdeaId),
    index("debate_matches_second_idea_id_idx").on(table.secondIdeaId),
    index("debate_matches_winner_idea_id_idx").on(table.winnerIdeaId),
    check(
      "debate_matches_ideas_check",
      sql`${table.position} >= 0 and ${table.firstIdeaId} != ${table.secondIdeaId}`,
    ),
    check(
      "debate_matches_winner_check",
      sql`${table.winnerIdeaId} is null or ${table.winnerIdeaId} in (${table.firstIdeaId}, ${table.secondIdeaId})`,
    ),
    check(
      "debate_matches_completion_check",
      sql`(
        (${table.winnerIdeaId} is null and ${table.completedAt} is null)
        or
        (${table.winnerIdeaId} is not null and ${table.completedAt} is not null)
      )`,
    ),
  ],
)

/**
 * One streamed message in a match transcript. A row per generation avoids a
 * fixed set of opening/rebuttal/verdict columns and permits longer debates
 * without changing the schema.
 *
 * speakerSlot 0 and 1 refer to the match's first and second idea; slot 2 is the
 * judge. Message kind is intentionally not stored because the UI only displays
 * the transcript. Position is durable because timestamps can tie under
 * concurrency and therefore cannot preserve reply order.
 */
export const debateMessages = sqliteTable(
  "debate_messages",
  {
    debateMessageId: text("debate_message_id").primaryKey(),
    debateMatchId: text("debate_match_id")
      .notNull()
      .references(() => debateMatches.debateMatchId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    speakerSlot: integer("speaker_slot").notNull(),
    llmGenerationId: text("llm_generation_id")
      .notNull()
      .unique()
      .references(
        (): AnySQLiteColumn => llmGenerations.llmGenerationId,
        { onDelete: "no action" },
      ),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    uniqueIndex("debate_messages_match_position_idx").on(
      table.debateMatchId,
      table.position,
    ),
    uniqueIndex("debate_messages_match_judge_idx")
      .on(table.debateMatchId)
      // A match has one final judge explanation, identified solely by slot 2.
      .where(sql`${table.speakerSlot} = 2`),
    check(
      "debate_messages_speaker_check",
      sql`${table.position} >= 0 and ${table.speakerSlot} in (0, 1, 2)`,
    ),
  ],
)

/** Lets owner FKs target the debate root without importing its inferred type. */
export function getDebateJobOwnerColumns(): [
  AnySQLiteColumn,
  AnySQLiteColumn,
] {
  return [debateJobs.debateJobId, debateJobs.userId]
}
