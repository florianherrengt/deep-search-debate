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
  it("creates the complete current schema from the fresh baseline", () => {
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
    expect(tableNames.has("research_job_admissions")).toBe(true)
    expect(
      sqlite
        .prepare("SELECT count(*) FROM __drizzle_migrations")
        .pluck()
        .get(),
    ).toBe(1)
    expect(
      sqlite
        .prepare("PRAGMA table_info('user')")
        .all()
        .find(
          (column) => (column as { name?: unknown }).name === "credits",
        ),
    ).toMatchObject({ dflt_value: "500" })
    expect(
      sqlite
        .prepare("PRAGMA table_info('deep_search_rounds')")
        .all()
        .some(
          (column) =>
            (column as { name?: unknown }).name === "answer_generation_id",
        ),
    ).toBe(true)
    for (const tableName of [
      "deep_search_jobs",
      "idea_jobs",
      "debate_jobs",
    ]) {
      const columnNames = sqlite
        .prepare(`PRAGMA table_info('${tableName}')`)
        .all()
        .map((column) => (column as { name: string }).name)
      expect(
        columnNames,
      ).toEqual(expect.arrayContaining([
        "cancel_requested_at",
        "feedback_rating",
        "feedback_text",
      ]))
    }
    expect(
      sqlite
        .prepare("PRAGMA table_info('deep_search_jobs')")
        .all()
        .some(
          (column) =>
            (column as { name?: unknown }).name ===
            "research_analysis_generation_id",
        ),
    ).toBe(true)
    const researchAnalysisForeignKey = sqlite
      .prepare("PRAGMA foreign_key_list('deep_search_jobs')")
      .all()
      .find(
        (row) =>
          (row as { from?: unknown }).from ===
          "research_analysis_generation_id",
      ) as { id: number }
    expect(
      sqlite
        .prepare("PRAGMA foreign_key_list('deep_search_jobs')")
        .all()
        .filter((row) => (row as { id: number }).id === researchAnalysisForeignKey.id)
        .map((row) => ({
          from: (row as { from: string }).from,
          table: (row as { table: string }).table,
          to: (row as { to: string }).to,
        })),
    ).toEqual([
      {
        from: "research_analysis_generation_id",
        table: "llm_generations",
        to: "llm_generation_id",
      },
      { from: "user_id", table: "llm_generations", to: "user_id" },
      {
        from: "deep_search_job_id",
        table: "llm_generations",
        to: "deep_search_job_id",
      },
    ])
    expect(sqlite.pragma("foreign_key_check")).toEqual([])
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")

    const triggerNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .pluck()
      .all()
    expect(triggerNames).toEqual(
      expect.arrayContaining([
        "deep_search_results_selected_web_page_owner_insert",
        "deep_search_results_selected_web_page_owner_update",
        "deep_search_results_selected_web_page_url_insert",
        "deep_search_results_selected_web_page_url_update",
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
