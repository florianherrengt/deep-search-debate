import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { describe, expect, it } from "vitest"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
)

describe("fresh database migration", () => {
  it("creates the complete current schema from one baseline", () => {
    expect(
      readdirSync(migrationsFolder).filter((name) => name.endsWith(".sql")),
    ).toEqual(["0000_fresh-baseline.sql"])

    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    migrate(drizzle(sqlite), { migrationsFolder })

    const tableNames = new Set(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .pluck()
        .all(),
    )
    expect(tableNames.has("deep_search_rounds")).toBe(true)
    expect(tableNames.has("deep_search_queries")).toBe(true)

    expect(
      sqlite
        .prepare("SELECT count(*) FROM __drizzle_migrations")
        .pluck()
        .get(),
    ).toBe(1)
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
        "deep_search_results_web_page_url_insert",
        "deep_search_results_web_page_url_update",
        "deep_search_round_structure_immutable",
        "deep_search_query_structure_immutable",
        "deep_search_web_page_identity_immutable",
        "llm_generation_owner_immutable",
        "idea_terminal_insert_guard",
        "idea_update_immutable",
        "idea_direct_delete_guard",
      ]),
    )
    sqlite.close()
  })
})
