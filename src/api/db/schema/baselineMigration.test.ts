import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { describe, expect, it } from "vitest"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
)
const baselineMigrationPath = fileURLToPath(
  new URL("../../drizzle/0000_complete_masked_marvel.sql", import.meta.url),
)
const baselineMigrationTimestamp = 1786024188543

function applyOriginalBaseline(sqlite: Database.Database): void {
  for (const statement of readFileSync(baselineMigrationPath, "utf8").split(
    "--> statement-breakpoint",
  )) {
    if (statement.trim()) sqlite.exec(statement)
  }
  sqlite.exec(`
    CREATE TABLE __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `)
  sqlite
    .prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    )
    .run("original-baseline", baselineMigrationTimestamp)
}

describe("migration chain", () => {
  it("creates the complete schema through the real migrator", () => {
    expect(
      readdirSync(migrationsFolder).filter((name) => name.endsWith(".sql")),
    ).toHaveLength(2)

    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    migrate(drizzle(sqlite), { migrationsFolder })

    expect(
      sqlite
        .prepare("SELECT count(*) FROM __drizzle_migrations")
        .pluck()
        .get(),
    ).toBe(2)
    expect(sqlite.pragma("foreign_key_check")).toEqual([])
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")

    const triggerNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .pluck()
      .all()
    expect(triggerNames).toEqual(
      expect.arrayContaining([
        "deep_search_results_web_page_owner_insert",
        "deep_search_results_web_page_owner_update",
        "deep_search_query_generation_owner_immutable",
        "deep_search_generated_query_owner_immutable",
        "deep_search_query_owner_immutable",
        "deep_search_web_page_owner_immutable",
        "llm_generation_owner_immutable",
        "idea_terminal_insert_guard",
        "idea_update_immutable",
        "idea_direct_delete_guard",
      ]),
    )
    sqlite.close()
  })

  it("upgrades a database that already applied the original baseline", () => {
    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    applyOriginalBaseline(sqlite)
    sqlite
      .prepare("INSERT INTO user (id, name, email) VALUES (?, ?, ?)")
      .run("migration-user", "Migration User", "migration@example.com")
    sqlite
      .prepare(
        `INSERT INTO deep_search_jobs (
          deep_search_job_id, user_id, research_request,
          max_searches, max_results_per_search
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run("existing-search", "migration-user", "Existing search", 3, 3)
    sqlite
      .prepare(
        `INSERT INTO idea_jobs (
          idea_job_id, user_id, prompt, number_of_ideas, deep_search_count
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run("existing-ideas", "migration-user", "Existing ideas", 12, 2)

    migrate(drizzle(sqlite), { migrationsFolder })

    expect(
      sqlite
        .prepare(
          "SELECT title, slug FROM deep_search_jobs WHERE deep_search_job_id = ?",
        )
        .get("existing-search"),
    ).toEqual({ title: "Untitled", slug: "untitled" })
    expect(
      sqlite
        .prepare("SELECT title, slug FROM idea_jobs WHERE idea_job_id = ?")
        .get("existing-ideas"),
    ).toEqual({ title: "Untitled", slug: "untitled" })
    expect(
      sqlite
        .prepare("SELECT count(*) FROM __drizzle_migrations")
        .pluck()
        .get(),
    ).toBe(2)
    expect(sqlite.pragma("foreign_key_check")).toEqual([])
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
    sqlite.close()
  })
})
