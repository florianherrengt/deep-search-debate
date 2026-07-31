import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const searches = sqliteTable("searches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  query: text("query").notNull(),
  results: text("results", { mode: "json" }).notNull().$type<
    { title: string; shortText: string; link: string }[]
  >(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$default(() => new Date()),
});
