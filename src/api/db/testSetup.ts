import { fileURLToPath } from "node:url"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { db } from "./index.ts"
import { user } from "./schema/index.ts"

export const testUserId = "test-user-id"

migrate(db, {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
})

db.insert(user)
  .values({
    id: testUserId,
    name: "Test User",
    email: "test-user@example.com",
    emailVerified: true,
    credits: 1_000_000,
  })
  .onConflictDoNothing()
  .run()
