import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { migrateDatabase } from "../migrate.ts"
import { describe, expect, it } from "vitest"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
)

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

  expect(() =>
    insertConnection.run(
      `${prefix}-invalid`,
      "connection-empty-ciphertext",
      Buffer.alloc(0),
      Buffer.alloc(12),
      Buffer.alloc(16),
    ),
  ).toThrow(/openai_codex_connections_ciphertext_check/)
  expect(() =>
    insertConnection.run(
      `${prefix}-invalid`,
      "connection-text-ciphertext",
      "ciphertext",
      Buffer.alloc(12),
      Buffer.alloc(16),
    ),
  ).toThrow(/openai_codex_connections_ciphertext_check/)
  expect(() =>
    insertConnection.run(
      `${prefix}-invalid`,
      "connection-bad-nonce",
      Buffer.from("ciphertext"),
      Buffer.alloc(11),
      Buffer.alloc(16),
    ),
  ).toThrow(/openai_codex_connections_nonce_check/)
  expect(() =>
    insertConnection.run(
      `${prefix}-invalid`,
      "connection-bad-tag",
      Buffer.from("ciphertext"),
      Buffer.alloc(12),
      Buffer.alloc(15),
    ),
  ).toThrow(/openai_codex_connections_authentication_tag_check/)

  sqlite.prepare("DELETE FROM user WHERE id = ?").run(`${prefix}-valid`)
  expect(
    sqlite
      .prepare(
        "SELECT count(*) FROM openai_codex_connections WHERE user_id = ?",
      )
      .pluck()
      .get(`${prefix}-valid`),
  ).toBe(0)
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
  it("preserves saved idea ownership while adding the ready boundary and one-time debate attachment", () => {
    const previousFolder = mkdtempSync(join(tmpdir(), "rethinkloop-discovery-upgrade-"))
    const databasePath = join(previousFolder, "upgrade.db")
    const sqlite = new Database(databasePath)
    let observer: Database.Database | undefined
    try {
      mkdirSync(join(previousFolder, "meta"))
      const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8")) as {
        entries: { idx: number; tag: string }[]
      }
      journal.entries = journal.entries.filter(({ idx }) => idx < 3)
      for (const { tag } of journal.entries) {
        copyFileSync(join(migrationsFolder, `${tag}.sql`), join(previousFolder, `${tag}.sql`))
      }
      writeFileSync(join(previousFolder, "meta/_journal.json"), JSON.stringify(journal))
      migrateDatabase(sqlite, { migrationsFolder: previousFolder })
      sqlite.exec(`
        INSERT INTO user (id, name, email, email_verified) VALUES
          ('upgrade-owner', 'Owner', 'owner@example.com', 1),
          ('foreign-owner', 'Foreign', 'foreign@example.com', 1);
        INSERT INTO debate_jobs (debate_job_id, user_id, random_seed) VALUES ('old-debate', 'upgrade-owner', 1);
        INSERT INTO idea_jobs (idea_job_id, user_id, debate_job_id, title, slug, prompt, number_of_ideas, deep_search_count, max_searches, max_results_per_search, max_rounds)
          VALUES ('old-idea-job', 'upgrade-owner', 'old-debate', 'Saved title', 'saved-title', 'Saved request', 6, 2, 1, 1, 1);
        INSERT INTO ideas (idea_id, idea_job_id, position, title, description)
          VALUES ('old-idea', 'old-idea-job', 0, 'Saved idea', 'Saved description');
        INSERT INTO deep_search_jobs (deep_search_job_id, user_id, idea_job_id, idea_job_position, research_request, max_searches, max_results_per_search, strict_quality)
          VALUES ('old-search', 'upgrade-owner', 'old-idea-job', 0, 'Saved research request', 1, 1, 1);
        INSERT INTO llm_generations (llm_generation_id, user_id, deep_search_job_id, status, text, reasoning, completed_at)
          VALUES ('old-evidence', 'upgrade-owner', 'old-search', 'completed', 'Saved evidence', '', 1000);
        UPDATE deep_search_jobs SET status='completed', final_answer_generation_id='old-evidence', completed_at=1000 WHERE deep_search_job_id='old-search';
      `)
      const beforeIdeaJob = sqlite.prepare("SELECT * FROM idea_jobs").get()
      const descendants = ["debate_jobs", "ideas", "deep_search_jobs", "llm_generations"]
      const before = descendants.map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all())
      const triggers = sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").pluck().all()
      observer = new Database(databasePath)
      const existingRead = observer.prepare("SELECT * FROM idea_jobs WHERE idea_job_id='old-idea-job'")
      expect(existingRead.get()).toEqual(beforeIdeaJob)

      // A failure after the CHECK edits must roll back both schema and data,
      // and restore the driver's protections before the same connection retries.
      const migrationName = "0003_space-discovery.sql"
      writeFileSync(join(previousFolder, migrationName), readFileSync(join(migrationsFolder, migrationName), "utf8")
        .replace("SELECT NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check)", "SELECT 0"))
      copyFileSync(join(migrationsFolder, "meta/_journal.json"), join(previousFolder, "meta/_journal.json"))
      expect(() => migrateDatabase(sqlite, { migrationsFolder: previousFolder })).toThrow(/discovery_migration_guard/)
      expect(existingRead.get()).toEqual(beforeIdeaJob)
      expect(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get()).toBe(3)
      expect(sqlite.pragma("writable_schema", { simple: true })).toBe(0)
      sqlite.pragma("writable_schema=ON")
      expect(() => sqlite.exec("UPDATE sqlite_schema SET sql=sql WHERE name='idea_jobs'")).toThrow(/may not be modified/)
      sqlite.pragma("writable_schema=RESET")

      migrateDatabase(sqlite)

      expect(existingRead.get()).toEqual({ ...(beforeIdeaJob as object), workflow: "research" })
      for (const [index, table] of descendants.entries()) {
        expect(sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[index])
      }
      expect(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").pluck().all()).toEqual(expect.arrayContaining(triggers))
      expect(() => sqlite.exec("UPDATE idea_jobs SET workflow='discovery' WHERE idea_job_id='old-idea-job'")).toThrow(/workflow is immutable/)
      expect(() => sqlite.exec("UPDATE idea_jobs SET status='ready' WHERE idea_job_id='old-idea-job'")).toThrow(/terminal_fields_check/)
      expect(() => sqlite.exec("UPDATE idea_jobs SET status='completed', stage='ideas', completed_at=1000 WHERE idea_job_id='old-idea-job'")).toThrow(/terminal_fields_check/)
      expect(() => sqlite.exec("UPDATE idea_jobs SET status='unknown' WHERE idea_job_id='old-idea-job'")).toThrow(/check/i)

      sqlite.exec(`
        INSERT INTO idea_jobs (idea_job_id, user_id, workflow, slug, prompt, stage, number_of_ideas, deep_search_count, max_searches, max_results_per_search, max_rounds)
          VALUES ('new-ideas', 'upgrade-owner', 'discovery', 'new-ideas', 'Discover options', 'ideas', 6, 1, 1, 1, 1);
        INSERT INTO llm_generations (llm_generation_id, user_id, idea_job_id, status, text, reasoning, completed_at)
          VALUES ('new-generated', 'upgrade-owner', 'new-ideas', 'completed', 'Generated ideas', '', 1000),
                 ('new-selection', 'upgrade-owner', 'new-ideas', 'completed', 'Selected ideas', '', 1000);
        UPDATE idea_jobs SET idea_generation_id='new-generated', status='ready' WHERE idea_job_id='new-ideas';
        INSERT INTO debate_jobs (debate_job_id, user_id, random_seed) VALUES
          ('new-debate', 'upgrade-owner', 2), ('other-debate', 'upgrade-owner', 3), ('foreign-debate', 'foreign-owner', 4);
      `)
      expect(observer.prepare("SELECT status, workflow FROM idea_jobs WHERE idea_job_id='new-ideas'").get()).toEqual({ status: "ready", workflow: "discovery" })
      expect(() => sqlite.exec("UPDATE idea_jobs SET deep_search_count=2 WHERE idea_job_id='new-ideas'")).toThrow(/workflow_check/)
      expect(() => sqlite.exec("UPDATE idea_jobs SET status='completed', completed_at=1000 WHERE idea_job_id='new-ideas'")).toThrow(/terminal_fields_check/)
      expect(() => sqlite.exec("UPDATE idea_jobs SET debate_job_id='foreign-debate', status='running' WHERE idea_job_id='new-ideas'")).toThrow(/FOREIGN KEY/)
      sqlite.exec("UPDATE idea_jobs SET debate_job_id='new-debate', status='running' WHERE idea_job_id='new-ideas'")
      expect(() => sqlite.exec("UPDATE idea_jobs SET debate_job_id='other-debate' WHERE idea_job_id='new-ideas'")).toThrow(/parent columns are immutable/)
      expect(() => sqlite.exec("UPDATE idea_jobs SET debate_job_id=NULL WHERE idea_job_id='new-ideas'")).toThrow(/parent columns are immutable/)
      sqlite.exec("UPDATE idea_jobs SET selection_generation_id='new-selection', status='completed', completed_at=1000 WHERE idea_job_id='new-ideas'")
      expect(sqlite.prepare("SELECT research_prompt_generation_id, research_summary_generation_id FROM idea_jobs WHERE idea_job_id='new-ideas'").get()).toEqual({ research_prompt_generation_id: null, research_summary_generation_id: null })
      expect(sqlite.pragma("writable_schema", { simple: true })).toBe(0)
      sqlite.pragma("writable_schema=ON")
      expect(() => sqlite.exec("UPDATE sqlite_schema SET sql=sql WHERE name='idea_jobs'")).toThrow(/may not be modified/)
      sqlite.pragma("writable_schema=RESET")
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
      sqlite.exec("DELETE FROM debate_jobs WHERE debate_job_id='old-debate'")
      expect(sqlite.prepare("SELECT * FROM ideas WHERE idea_id='old-idea'").all()).toEqual([])
      expect(sqlite.prepare("SELECT * FROM deep_search_jobs WHERE deep_search_job_id='old-search'").all()).toEqual([])
      expect(sqlite.prepare("SELECT * FROM llm_generations WHERE llm_generation_id='old-evidence'").all()).toEqual([])
    } finally {
      observer?.close()
      sqlite.close()
      rmSync(previousFolder, { recursive: true, force: true })
    }
  })

  it("creates the complete current schema from the fresh baseline", () => {
    expect(
      readdirSync(migrationsFolder).filter((name) => name.endsWith(".sql")),
    ).toEqual(["0000_fresh-baseline.sql", "0001_linked-page-discovery.sql", "0002_original-source-passages.sql", "0003_space-discovery.sql"])

    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    migrateDatabase(sqlite, { migrationsFolder })

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
    expect(tableNames.has("deep_search_page_links")).toBe(true)
    expect(
      sqlite
        .prepare("SELECT count(*) FROM __drizzle_migrations")
        .pluck()
        .get(),
    ).toBe(4)
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

  it("adds retained passages without changing completed pages, provider selections, linked edges, or triggers", () => {
    const previousFolder = mkdtempSync(join(tmpdir(), "rethinkloop-previous-schema-"))
    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    try {
      mkdirSync(join(previousFolder, "meta"))
      copyFileSync(join(migrationsFolder, "0000_fresh-baseline.sql"), join(previousFolder, "0000_fresh-baseline.sql"))
      copyFileSync(join(migrationsFolder, "0001_linked-page-discovery.sql"), join(previousFolder, "0001_linked-page-discovery.sql"))
      writeFileSync(join(previousFolder, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries: [
        { idx: 0, version: "6", when: 1788526464242, tag: "0000_fresh-baseline", breakpoints: true },
        { idx: 1, version: "6", when: 1788806288034, tag: "0001_linked-page-discovery", breakpoints: true },
      ] }))
      migrateDatabase(sqlite, { migrationsFolder: previousFolder })
      sqlite.exec(`
        INSERT INTO user (id, name, email, email_verified) VALUES ('upgrade-owner', 'Owner', 'upgrade-owner@example.com', 1);
        INSERT INTO deep_search_jobs (deep_search_job_id, user_id, research_request, max_searches, max_results_per_search, strict_quality)
          VALUES ('old-job', 'upgrade-owner', 'Preserved question', 1, 1, 0);
        INSERT INTO llm_generations (llm_generation_id, user_id, deep_search_job_id, status, text, reasoning, completed_at)
          VALUES ('old-summary', 'upgrade-owner', 'old-job', 'completed', 'Preserved source evidence', '', 1000),
                 ('old-target-summary', 'upgrade-owner', 'old-job', 'completed', 'Preserved linked evidence', '', 1000),
                 ('old-query-summary', 'upgrade-owner', 'old-job', 'completed', 'Preserved query summary', '', 1000),
                 ('old-plan', 'upgrade-owner', 'old-job', 'completed', '["Preserved query"]', '', 1000),
                 ('old-selection', 'upgrade-owner', 'old-job', 'completed', '["old-result"]', '', 1000),
                 ('old-link-selection', 'upgrade-owner', 'old-job', 'completed', '{"selectedIds":["old-link"]}', '', 1000),
                 ('old-answer', 'upgrade-owner', 'old-job', 'completed', 'Preserved final answer', '', 1000);
        INSERT INTO deep_search_rounds (deep_search_round_id, deep_search_job_id, llm_generation_id, answer_generation_id)
          VALUES ('old-round', 'old-job', 'old-plan', 'old-answer');
        INSERT INTO deep_search_queries (deep_search_query_id, deep_search_round_id, position, query, credits_used, status, selection_generation_id, summary_generation_id, completed_at)
          VALUES ('old-query', 'old-round', 0, 'Preserved query', 1, 'completed', 'old-selection', 'old-query-summary', 1000);
        INSERT INTO deep_search_web_pages (deep_search_web_page_id, deep_search_job_id, url, status, credits_used, summary_generation_id, link_selection_generation_id, completed_at)
          VALUES ('old-page', 'old-job', 'https://example.com/old-source', 'completed', 1, 'old-summary', 'old-link-selection', 1000),
                 ('old-target', 'old-job', 'https://example.com/old-target', 'completed', 1, 'old-target-summary', null, 1000);
        INSERT INTO deep_search_results (deep_search_result_id, deep_search_query_id, position, title, short_text, url, selected_web_page_id)
          VALUES ('old-result', 'old-query', 0, 'Preserved source', 'Preserved provider snippet', 'https://example.com/old-source', 'old-page');
        INSERT INTO deep_search_page_links (deep_search_page_link_id, source_web_page_id, position, url, title, selected_web_page_id, selected_round_id)
          VALUES ('old-link', 'old-page', 0, 'https://example.com/old-target', 'Preserved linked source', 'old-target', 'old-round');
        UPDATE deep_search_jobs SET status = 'completed', final_answer_generation_id = 'old-answer', completed_at = 1000 WHERE deep_search_job_id = 'old-job';
      `)
      const oldJob = sqlite.prepare("SELECT * FROM deep_search_jobs WHERE deep_search_job_id = 'old-job'").get()
      const oldResults = sqlite.prepare("SELECT * FROM deep_search_results").all()
      const oldLinks = sqlite.prepare("SELECT * FROM deep_search_page_links").all()
      const oldGenerations = sqlite.prepare("SELECT * FROM llm_generations ORDER BY llm_generation_id").all()
      const oldTriggers = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").pluck().all()
      migrateDatabase(sqlite, { migrationsFolder })
      expect(sqlite.prepare("SELECT * FROM deep_search_jobs WHERE deep_search_job_id = 'old-job'").get()).toEqual(oldJob)
      expect(sqlite.prepare("SELECT status, credits_used, extracted_content, original_passages, summary_generation_id, link_selection_generation_id FROM deep_search_web_pages WHERE deep_search_web_page_id = 'old-page'").get()).toEqual({ status: "completed", credits_used: 1, extracted_content: null, original_passages: null, summary_generation_id: "old-summary", link_selection_generation_id: "old-link-selection" })
      expect(sqlite.prepare("SELECT * FROM deep_search_results").all()).toEqual(oldResults)
      expect(sqlite.prepare("SELECT * FROM deep_search_page_links").all()).toEqual(oldLinks)
      expect(sqlite.prepare("SELECT * FROM llm_generations ORDER BY llm_generation_id").all()).toEqual(oldGenerations)
      expect(sqlite.prepare("SELECT original_passages FROM deep_search_web_pages").pluck().all()).toEqual([null, null])
      sqlite.prepare("UPDATE deep_search_web_pages SET original_passages = ? WHERE deep_search_web_page_id = 'old-page'").run("x".repeat(16_000))
      expect(() => sqlite.prepare("UPDATE deep_search_web_pages SET original_passages = ? WHERE deep_search_web_page_id = 'old-page'").run("x".repeat(16_001))).toThrow(/original_passages_check/)
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").pluck().all()).toEqual(expect.arrayContaining(oldTriggers))
      expect(() => sqlite.prepare("UPDATE deep_search_web_pages SET url = 'https://example.com/changed' WHERE deep_search_web_page_id = 'old-page'").run()).toThrow(/immutable/)
      expect(() => sqlite.prepare("UPDATE deep_search_page_links SET selected_web_page_id = null, selected_round_id = null WHERE deep_search_page_link_id = 'old-link'").run()).toThrow(/immutable/)
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
      sqlite.prepare("DELETE FROM deep_search_jobs WHERE deep_search_job_id = 'old-job'").run()
      expect(sqlite.prepare("SELECT * FROM deep_search_web_pages").all()).toEqual([])
      expect(sqlite.prepare("SELECT * FROM deep_search_results").all()).toEqual([])
      expect(sqlite.prepare("SELECT * FROM deep_search_page_links").all()).toEqual([])
      expect(sqlite.prepare("SELECT * FROM llm_generations").all()).toEqual([])
    } finally {
      sqlite.close()
      rmSync(previousFolder, { recursive: true, force: true })
    }
  })
})
