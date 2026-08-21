import { sql } from "drizzle-orm"
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const waitlistEntries = sqliteTable(
  "waitlist_entries",
  {
    waitlistEntryId: text("waitlist_entry_id").primaryKey(),
    email: text("email").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    uniqueIndex("waitlist_entries_email_idx").on(table.email),
    check(
      "waitlist_entries_email_normalized_check",
      sql`${table.email} = lower(trim(${table.email})) and length(${table.email}) between 1 and 254`,
    ),
  ],
)
