import { sql } from "drizzle-orm"
import { check, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { user } from "./auth.ts"

export const llmModelProviders = ["deepseek", "openai"] as const
export const llmReasoningEfforts = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const

/** The user's exact model and reasoning choices for the two application roles. */
export const llmModelSettings = sqliteTable(
  "llm_model_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    smallProvider: text("small_provider", { enum: llmModelProviders })
      .notNull(),
    smallModelId: text("small_model_id").notNull(),
    smallReasoningEffort: text("small_reasoning_effort", {
      enum: llmReasoningEfforts,
    }).notNull(),
    bigProvider: text("big_provider", { enum: llmModelProviders }).notNull(),
    bigModelId: text("big_model_id").notNull(),
    bigReasoningEffort: text("big_reasoning_effort", {
      enum: llmReasoningEfforts,
    }).notNull(),
  },
  (table) => [
    check(
      "llm_model_settings_small_provider_check",
      sql`${table.smallProvider} in ('deepseek', 'openai')`,
    ),
    check(
      "llm_model_settings_small_model_id_check",
      sql`length(trim(${table.smallModelId})) > 0`,
    ),
    check(
      "llm_model_settings_small_reasoning_effort_check",
      sql`${table.smallReasoningEffort} in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra')`,
    ),
    check(
      "llm_model_settings_big_provider_check",
      sql`${table.bigProvider} in ('deepseek', 'openai')`,
    ),
    check(
      "llm_model_settings_big_model_id_check",
      sql`length(trim(${table.bigModelId})) > 0`,
    ),
    check(
      "llm_model_settings_big_reasoning_effort_check",
      sql`${table.bigReasoningEffort} in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra')`,
    ),
  ],
)
