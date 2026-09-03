import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { describe, expect, it } from "vitest"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
)

function applySqlMigration(sqlite: Database.Database, filename: string): void {
  const migration = readFileSync(`${migrationsFolder}/${filename}`, "utf8")
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim().length > 0) sqlite.exec(statement)
  }
}

function expectOpenAiConnectionIdentityConstraints(
  sqlite: Database.Database,
  prefix: string,
): void {
  const insertUser = sqlite.prepare(
    "INSERT INTO user (id, name, email, email_verified) VALUES (?, ?, ?, ?)",
  )
  for (const suffix of ["valid", "invalid"]) {
    insertUser.run(
      `${prefix}-${suffix}`,
      `Constraint ${suffix}`,
      `${prefix}-${suffix}@example.com`,
      1,
    )
  }

  const insertConnection = sqlite.prepare(`
    INSERT INTO openai_codex_connections (
      user_id,
      connection_id,
      credentials_ciphertext,
      credentials_nonce,
      credentials_authentication_tag
    ) VALUES (?, ?, ?, ?, ?)
  `)
  const validPayload = [
    Buffer.from("ciphertext"),
    Buffer.alloc(12),
    Buffer.alloc(16),
  ] as const

  insertConnection.run(
    `${prefix}-valid`,
    "connection-valid",
    ...validPayload,
  )
  expect(
    sqlite
      .prepare(
        "SELECT connection_id FROM openai_codex_connections WHERE user_id LIKE ?",
      )
      .all(`${prefix}-%`),
  ).toEqual([{ connection_id: "connection-valid" }])

  for (const connectionId of ["", "   "]) {
    expect(() =>
      insertConnection.run(
        `${prefix}-invalid`,
        connectionId,
        ...validPayload,
      ),
    ).toThrow(/openai_codex_connections_connection_id_check/)
  }
}

function expectLlmModelSettingsConstraints(
  sqlite: Database.Database,
  prefix: string,
): void {
  const insertUser = sqlite.prepare(
    "INSERT INTO user (id, name, email, email_verified) VALUES (?, ?, ?, ?)",
  )
  for (const suffix of ["valid", "invalid"]) {
    insertUser.run(
      `${prefix}-settings-${suffix}`,
      `Settings ${suffix}`,
      `${prefix}-settings-${suffix}@example.com`,
      1,
    )
  }
  const insertSettings = sqlite.prepare(`
    INSERT INTO llm_model_settings (
      user_id,
      small_provider,
      small_model_id,
      small_reasoning_effort,
      big_provider,
      big_model_id,
      big_reasoning_effort
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  insertSettings.run(
    `${prefix}-settings-valid`,
    "deepseek",
    "deepseek-v4-flash",
    "medium",
    "openai",
    "gpt-5.6-sol",
    "xhigh",
  )
  expect(() =>
    insertSettings.run(
      `${prefix}-settings-invalid`,
      "zen",
      "configured-model",
      "medium",
      "deepseek",
      "deepseek-v4-pro",
      "xhigh",
    ),
  ).toThrow(/llm_model_settings_small_provider_check/)
  expect(() =>
    insertSettings.run(
      `${prefix}-settings-invalid`,
      "deepseek",
      "   ",
      "medium",
      "deepseek",
      "deepseek-v4-pro",
      "xhigh",
    ),
  ).toThrow(/llm_model_settings_small_model_id_check/)
  expect(() =>
    insertSettings.run(
      `${prefix}-settings-invalid`,
      "deepseek",
      "deepseek-v4-flash",
      "extreme",
      "deepseek",
      "deepseek-v4-pro",
      "xhigh",
    ),
  ).toThrow(/llm_model_settings_small_reasoning_effort_check/)

  sqlite
    .prepare("DELETE FROM user WHERE id = ?")
    .run(`${prefix}-settings-valid`)
  expect(
    sqlite
      .prepare("SELECT count(*) FROM llm_model_settings WHERE user_id = ?")
      .pluck()
      .get(`${prefix}-settings-valid`),
  ).toBe(0)
}

describe("database migrations", () => {
  it("creates the complete current schema from the fresh baseline", () => {
    expect(
      readdirSync(migrationsFolder).filter((name) => name.endsWith(".sql")),
    ).toEqual([
      "0000_fresh-baseline.sql",
      "0001_eager_stone_men.sql",
      "0002_dizzy_genesis.sql",
    ])

    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    migrate(drizzle(sqlite), { migrationsFolder })

    expectOpenAiConnectionIdentityConstraints(sqlite, "fresh")
    expectLlmModelSettingsConstraints(sqlite, "fresh")

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
    expect(tableNames.has("openai_codex_connections")).toBe(true)
    expect(tableNames.has("llm_model_settings")).toBe(true)
    expect(
      sqlite
        .prepare("SELECT count(*) FROM __drizzle_migrations")
        .pluck()
        .get(),
    ).toBe(3)
    expect(
      sqlite
        .prepare("PRAGMA table_info('openai_codex_connections')")
        .all()
        .map((column) => (column as { name: string }).name),
    ).toEqual([
      "user_id",
      "connection_id",
      "credentials_ciphertext",
      "credentials_nonce",
      "credentials_authentication_tag",
    ])
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
    expect(
      sqlite
        .prepare("PRAGMA table_info('deep_search_jobs')")
        .all()
        .find(
          (column) =>
            (column as { name?: unknown }).name === "strict_quality",
        ),
    ).toMatchObject({ notnull: 1, dflt_value: null })
    for (const columnName of [
      "max_searches",
      "max_results_per_search",
      "max_rounds",
    ]) {
      expect(
        sqlite
          .prepare("PRAGMA table_info('idea_jobs')")
          .all()
          .find(
            (column) =>
              (column as { name?: unknown }).name === columnName,
          ),
      ).toMatchObject({ notnull: 1, dflt_value: null })
    }
    expect(
      sqlite
        .prepare("PRAGMA table_info('deep_search_web_pages')")
        .all()
        .some(
          (column) =>
            (column as { name?: unknown }).name === "extracted_content",
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
    const debateJobForeignKeys = sqlite
      .prepare("PRAGMA foreign_key_list('debate_jobs')")
      .all() as Array<{
        id: number
        from: string
        table: string
        to: string
      }>
    const websiteGenerationForeignKeyId = debateJobForeignKeys.find(
      (row) => row.from === "website_generation_id",
    )?.id
    expect(
      debateJobForeignKeys
        .filter(
          (row) =>
            row.from === "website_generation_id" ||
            row.id === websiteGenerationForeignKeyId,
        )
        .map(({ from, table, to }) => ({ from, table, to })),
    ).toEqual([
      {
        from: "website_generation_id",
        table: "llm_generations",
        to: "llm_generation_id",
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
        "idea_job_parent_immutable",
        "deep_search_job_parent_immutable",
        "debate_match_selected_ideas_insert",
        "debate_round_structure_immutable",
        "debate_match_structure_immutable",
      ]),
    )
    sqlite.close()
  })

  it("upgrades the retained baseline without changing existing rows", () => {
    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    applySqlMigration(sqlite, "0000_fresh-baseline.sql")

    sqlite
      .prepare(
        "INSERT INTO user (id, name, email, credits, is_admin, email_verified) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("retained-user", "Retained User", "retained@example.com", 321, 1, 1)
    sqlite
      .prepare("INSERT INTO waitlist_entries (waitlist_entry_id, email) VALUES (?, ?)")
      .run("retained-waitlist-entry", "waitlist@example.com")

    applySqlMigration(sqlite, "0001_eager_stone_men.sql")
    applySqlMigration(sqlite, "0002_dizzy_genesis.sql")

    expectOpenAiConnectionIdentityConstraints(sqlite, "upgrade")
    expectLlmModelSettingsConstraints(sqlite, "upgrade")

    expect(
      sqlite
        .prepare("SELECT id, credits, is_admin FROM user WHERE id = ?")
        .get("retained-user"),
    ).toEqual({ id: "retained-user", credits: 321, is_admin: 1 })
    expect(
      sqlite
        .prepare("SELECT email FROM waitlist_entries WHERE waitlist_entry_id = ?")
        .get("retained-waitlist-entry"),
    ).toEqual({ email: "waitlist@example.com" })
    sqlite
      .prepare(
        "INSERT INTO user (id, name, email, email_verified) VALUES (?, ?, ?, ?)",
      )
      .run("constraint-user", "Constraint User", "constraint@example.com", 1)

    const insertConnection = sqlite.prepare(`
      INSERT INTO openai_codex_connections (
        user_id,
        connection_id,
        credentials_ciphertext,
        credentials_nonce,
        credentials_authentication_tag
      ) VALUES (?, ?, ?, ?, ?)
    `)
    insertConnection.run(
      "retained-user",
      "connection-1",
      Buffer.from("ciphertext"),
      Buffer.alloc(12),
      Buffer.alloc(16),
    )
    expect(() =>
      insertConnection.run(
        "constraint-user",
        "connection-empty-ciphertext",
        Buffer.alloc(0),
        Buffer.alloc(12),
        Buffer.alloc(16),
      ),
    ).toThrow(/openai_codex_connections_ciphertext_check/)
    expect(() =>
      insertConnection.run(
        "constraint-user",
        "connection-text-ciphertext",
        "ciphertext",
        Buffer.alloc(12),
        Buffer.alloc(16),
      ),
    ).toThrow(/openai_codex_connections_ciphertext_check/)
    expect(() =>
      insertConnection.run(
        "constraint-user",
        "connection-2",
        Buffer.from("ciphertext"),
        Buffer.alloc(11),
        Buffer.alloc(16),
      ),
    ).toThrow(/openai_codex_connections_nonce_check/)
    expect(() =>
      insertConnection.run(
        "constraint-user",
        "connection-bad-tag",
        Buffer.from("ciphertext"),
        Buffer.alloc(12),
        Buffer.alloc(15),
      ),
    ).toThrow(/openai_codex_connections_authentication_tag_check/)
    sqlite.prepare("DELETE FROM user WHERE id = ?").run("retained-user")
    expect(
      sqlite
        .prepare(
          "SELECT count(*) FROM openai_codex_connections WHERE user_id = ?",
        )
        .pluck()
        .get("retained-user"),
    ).toBe(0)
    expect(sqlite.pragma("foreign_key_check")).toEqual([])
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
    sqlite.close()
  })
})
