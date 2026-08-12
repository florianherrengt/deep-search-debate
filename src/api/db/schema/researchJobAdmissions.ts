import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core"

import { user } from "./auth.ts"

export const rootResearchJobKinds = [
  "deep-search",
  "idea",
  "debate",
] as const
export type RootResearchJobKind = (typeof rootResearchJobKinds)[number]

/**
 * Records charged root-workflow creation attempts before any provider call.
 * Rows deliberately survive failed title generation so failures cannot bypass
 * the rolling quota. They are removed only when their owning user is deleted.
 */
export const researchJobAdmissions = sqliteTable(
  "research_job_admissions",
  {
    researchJobAdmissionId: text("research_job_admission_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: rootResearchJobKinds }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    index("research_job_admissions_user_created_at_idx").on(
      table.userId,
      table.createdAt,
      table.researchJobAdmissionId,
    ),
    index("research_job_admissions_user_kind_created_at_idx").on(
      table.userId,
      table.kind,
      table.createdAt,
      table.researchJobAdmissionId,
    ),
    check(
      "research_job_admissions_kind_check",
      sql`${table.kind} in ('deep-search', 'idea', 'debate')`,
    ),
  ],
)
