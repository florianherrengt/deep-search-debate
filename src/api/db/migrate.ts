import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import type { MigrationConfig } from "drizzle-orm/migrator"
import { resolveRuntimeDefaults } from "../runtimeDefaults.ts"

/** Run committed migrations with metadata writes confined to this connection. */
export function migrateDatabase(
  sqlite: Database.Database,
  options: MigrationConfig = {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  },
): void {
  if (sqlite.inTransaction) throw new Error("Migrations require an idle connection")
  sqlite.pragma("foreign_keys = ON")
  // better-sqlite3's defensive mode otherwise rejects the guarded CHECK update
  // in 0003. Application queries always run with the protection restored.
  sqlite.unsafeMode(true)
  try {
    migrate(drizzle(sqlite), options)
  } finally {
    try {
      sqlite.pragma("writable_schema = RESET")
    } finally {
      sqlite.unsafeMode(false)
    }
  }
  if (sqlite.prepare("SELECT 1 FROM pragma_foreign_key_check LIMIT 1").get() !== undefined
    || sqlite.pragma("integrity_check", { simple: true }) !== "ok") {
    throw new Error("Migrated database failed its integrity check")
  }
}

if (import.meta.main) {
  const { config: loadEnvironment } = await import("dotenv")
  loadEnvironment({ quiet: true })
  const defaults = resolveRuntimeDefaults(process.env.NODE_ENV)
  const sqlite = new Database(process.env.DATABASE_URL ?? defaults.databaseUrl)
  try {
    migrateDatabase(sqlite)
  } finally {
    sqlite.close()
  }
}
