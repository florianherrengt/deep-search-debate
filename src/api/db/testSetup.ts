import { fileURLToPath } from "node:url"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { db } from "./index.ts"

migrate(db, {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
})
