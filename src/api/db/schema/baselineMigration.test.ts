import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { tmpdir } from "node:os"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { describe, expect, it } from "vitest"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
)

describe("database migrations", () => {
  it("creates the complete current schema from the full migration chain", () => {
    expect(
      readdirSync(migrationsFolder).filter((name) => name.endsWith(".sql")),
    ).toEqual([
      "0000_fresh-baseline.sql",
      "0001_complex_whistler.sql",
      "0002_modern_magus.sql",
      "0004_tricky_joshua_kane.sql",
    ])

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
    expect(tableNames.has("waitlist_entries")).toBe(true)
    expect(
      sqlite
        .prepare("SELECT count(*) FROM __drizzle_migrations")
        .pluck()
        .get(),
    ).toBe(4)
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
    expect(
      sqlite
        .prepare("PRAGMA table_info('debate_jobs')")
        .all()
        .some(
          (column) =>
            (column as { name?: unknown }).name ===
            "website_generation_id",
        ),
    ).toBe(true)
    expect(
      sqlite
        .prepare("PRAGMA foreign_key_list('debate_jobs')")
        .all()
        .some(
          (row) =>
            (row as { from?: unknown }).from === "website_generation_id" &&
            (row as { table?: unknown }).table === "llm_generations",
        ),
    ).toBe(true)
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

  it("upgrades a populated baseline database through the forward migration", () => {
    const priorMigrationsFolder = mkdtempSync(
      join(tmpdir(), "rethinkloop-prior-migrations-"),
    )
    const priorMetaFolder = join(priorMigrationsFolder, "meta")
    mkdirSync(priorMetaFolder)
    copyFileSync(
      join(migrationsFolder, "0000_fresh-baseline.sql"),
      join(priorMigrationsFolder, "0000_fresh-baseline.sql"),
    )
    copyFileSync(
      join(migrationsFolder, "0001_complex_whistler.sql"),
      join(priorMigrationsFolder, "0001_complex_whistler.sql"),
    )
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: unknown[] }
    writeFileSync(
      join(priorMetaFolder, "_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }),
    )

    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")

    try {
      migrate(drizzle(sqlite), { migrationsFolder: priorMigrationsFolder })
      sqlite.prepare(
        "INSERT INTO user (id, name, email) VALUES (?, ?, ?)",
      ).run("existing-user", "Existing User", "existing@example.com")
      // A fully populated debate at the pre-upgrade state: the forward
      // migrations must never rebuild or cascade-delete live tournament data.
      const debateJobId = "20000000-0000-4000-8000-000000000001"
      const ideaJobId = "20000000-0000-4000-8000-000000000002"
      const debateRoundId = "20000000-0000-4000-8000-000000000003"
      const debateMatchId = "20000000-0000-4000-8000-000000000004"
      const generationId = "20000000-0000-4000-8000-000000000005"
      const ideaId = "20000000-0000-4000-8000-000000000006"
      sqlite.exec(`
        INSERT INTO debate_jobs (debate_job_id, user_id, random_seed)
          VALUES ('${debateJobId}', 'existing-user', 42);
        INSERT INTO idea_jobs (idea_job_id, user_id, debate_job_id, prompt,
          number_of_ideas, deep_search_count, title, slug)
          VALUES ('${ideaJobId}', 'existing-user', '${debateJobId}',
            'Upgrade prompt', 6, 1, 'Upgrade Ideas', 'upgrade-ideas');
        INSERT INTO llm_generations (llm_generation_id, user_id, idea_job_id,
          status, text, reasoning, completed_at)
          VALUES ('${generationId}', 'existing-user', '${ideaJobId}',
            'completed', 'Briefing', 'reasoning', unixepoch() * 1000),
          ('20000000-0000-4000-8000-000000000007', 'existing-user',
            '${ideaJobId}', 'completed', 'Refinement', 'reasoning',
            unixepoch() * 1000);
        INSERT INTO llm_generations (llm_generation_id, user_id, idea_job_id,
          status, text, reasoning, completed_at)
          VALUES ('20000000-0000-4000-8000-000000000008', 'existing-user',
            '${ideaJobId}', 'completed', 'Refinement B', 'reasoning',
            unixepoch() * 1000);
        INSERT INTO ideas (idea_id, idea_job_id, position, title, description,
          selected, refinement_generation_id, refined_title,
          refined_description, evaluation_generation_id)
          VALUES
          ('${ideaId}', '${ideaJobId}', 0, 'Upgrade Idea',
            'Upgrade description', 1,
            '20000000-0000-4000-8000-000000000007',
            'Improved Upgrade Idea', 'Improved upgrade description', NULL),
          ('20000000-0000-4000-8000-000000000009', '${ideaJobId}', 1,
            'Upgrade Challenger', 'Challenger description', 1,
            '20000000-0000-4000-8000-000000000008',
            'Improved Upgrade Challenger',
            'Improved challenger description', NULL);
        INSERT INTO debate_rounds (debate_round_id, debate_job_id, stage,
          stage_round_number)
          VALUES ('${debateRoundId}', '${debateJobId}', 'swiss', 1);
        INSERT INTO debate_matches (debate_match_id, debate_round_id,
          position, first_idea_id, second_idea_id, winner_idea_id,
          completed_at)
          VALUES ('${debateMatchId}', '${debateRoundId}', 0, '${ideaId}',
            '20000000-0000-4000-8000-000000000009', '${ideaId}',
            unixepoch() * 1000);
      `)

      migrate(drizzle(sqlite), { migrationsFolder })

      expect(
        sqlite.prepare("SELECT email FROM user WHERE id = ?").get(
          "existing-user",
        ),
      ).toEqual({ email: "existing@example.com" })
      expect(
        sqlite
          .prepare("SELECT count(*) FROM __drizzle_migrations")
          .pluck()
          .get(),
      ).toBe(4)
      expect(
        sqlite
          .prepare("SELECT website_generation_id FROM debate_jobs LIMIT 1")
          .pluck()
          .get(),
      ).toBeNull()

      sqlite.prepare(
        "INSERT INTO waitlist_entries (waitlist_entry_id, email) VALUES (?, ?)",
      ).run(
        "10000000-0000-4000-8000-000000000001",
        "upgrade@example.com",
      )
      expect(
        sqlite.prepare(
          "SELECT waitlist_entry_id, email FROM waitlist_entries WHERE email = ?",
        ).get("upgrade@example.com"),
      ).toEqual({
        waitlist_entry_id: "10000000-0000-4000-8000-000000000001",
        email: "upgrade@example.com",
      })
      expect(
        sqlite
          .prepare("SELECT count(*) AS count FROM debate_matches")
          .pluck()
          .get(),
      ).toBe(1)
      expect(
        sqlite
          .prepare("SELECT count(*) AS count FROM ideas")
          .pluck()
          .get(),
      ).toBe(2)
      expect(
        sqlite
          .prepare("SELECT count(*) AS count FROM llm_generations")
          .pluck()
          .get(),
      ).toBe(3)
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
    } finally {
      sqlite.close()
      rmSync(priorMigrationsFolder, { recursive: true, force: true })
    }
  })
})
