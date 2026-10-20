import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { and, eq } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"

import { db } from "../../db/index.ts"
import { migrateDatabase } from "../../db/migrate.ts"
import {
  debateJobs,
  deepSearchJobs,
  deepSearchWebPages,
  ideaJobs,
  user,
} from "../../db/schema/index.ts"
import {
  registerCaptchaTask,
  reserveCaptchaAttempt,
} from "./captcha.ts"
import { solveCaptchaToken } from "../../web_search/capsolver.ts"

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url))

function insertUser(userId: string): void {
  db.insert(user)
    .values({
      id: userId,
      name: "CAPTCHA test user",
      email: `${userId}@example.com`,
      emailVerified: true,
    })
    .run()
}

function insertSearch(
  deepSearchJobId: string,
  userId: string,
  ideaJobId?: string,
  ideaJobPosition = 0,
): void {
  db.insert(deepSearchJobs)
    .values({
      deepSearchJobId,
      userId,
      ideaJobId,
      ideaJobPosition: ideaJobId === undefined ? undefined : ideaJobPosition,
      slug: `search-${deepSearchJobId}`,
      researchRequest: "Research this page",
      maxSearches: 1,
      maxResultsPerSearch: 1,
      strictQuality: false,
    })
    .run()
}

function insertPage(pageId: string, deepSearchJobId: string): void {
  db.insert(deepSearchWebPages)
    .values({
      deepSearchWebPageId: pageId,
      deepSearchJobId,
      url: `https://example.com/${pageId}`,
    })
    .run()
}

function insertDebateSubtree(prefix: string, searchCount: number): string[] {
  const ownerId = `${prefix}-owner`
  const debateId = `${prefix}-debate`
  const ideaId = `${prefix}-idea`
  insertUser(ownerId)
  db.insert(debateJobs).values({ debateJobId: debateId, userId: ownerId, randomSeed: 1 }).run()
  db.insert(ideaJobs).values({
    ideaJobId: ideaId,
    userId: ownerId,
    debateJobId: debateId,
    prompt: "Research a set of ideas",
    numberOfIdeas: 1,
    deepSearchCount: 1,
    maxSearches: 1,
    maxResultsPerSearch: 1,
    maxRounds: 1,
  }).run()
  const pageIds: string[] = []
  for (let index = 0; index < searchCount; index += 1) {
    const searchId = `${prefix}-search-${index}`
    const pageId = `${prefix}-page-${index}`
    insertSearch(searchId, ownerId, ideaId, index)
    insertPage(pageId, searchId)
    pageIds.push(pageId)
  }
  return pageIds
}

describe("CAPTCHA attempt persistence", () => {
  it("migrates a fresh in-memory database with one nullable task-state column", () => {
    const sqlite = new Database(":memory:")
    try {
      migrateDatabase(sqlite, { migrationsFolder })
      const columns = sqlite.prepare("PRAGMA table_info('deep_search_web_pages')").all() as { name: string }[]
      expect(columns.map(({ name }) => name)).toContain("captcha_task_id")
      expect(columns.map(({ name }) => name)).not.toContain("captcha_attempt_reserved_at")
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
    } finally {
      sqlite.close()
    }
  })

  it("upgrades a prior-schema database without losing pages or hand-written triggers", () => {
    const folder = mkdtempSync(join(tmpdir(), "rethinkloop-captcha-upgrade-"))
    const sqlite = new Database(":memory:")
    try {
      mkdirSync(join(folder, "meta"))
      const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8")) as {
        entries: { idx: number; tag: string }[]
      }
      const previousEntries = journal.entries.filter(({ idx }) => idx < 6)
      for (const { tag } of previousEntries) {
        copyFileSync(join(migrationsFolder, `${tag}.sql`), join(folder, `${tag}.sql`))
      }
      writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: previousEntries }))
      migrateDatabase(sqlite, { migrationsFolder: folder })
      sqlite.exec(`
        INSERT INTO user (id, name, email, email_verified) VALUES ('upgrade-owner', 'Owner', 'owner@example.com', 1);
        INSERT INTO deep_search_jobs (deep_search_job_id, user_id, research_request, max_searches, max_results_per_search, strict_quality)
          VALUES ('upgrade-search', 'upgrade-owner', 'Upgrade this page', 1, 1, 0);
        INSERT INTO deep_search_web_pages (deep_search_web_page_id, deep_search_job_id, url)
          VALUES ('upgrade-page', 'upgrade-search', 'https://example.com/upgrade');
      `)
      const pageBefore = sqlite.prepare("SELECT * FROM deep_search_web_pages WHERE deep_search_web_page_id='upgrade-page'").get()
      const triggersBefore = sqlite.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all()
      for (const { tag } of journal.entries) {
        if (!previousEntries.some((entry) => entry.tag === tag)) {
          copyFileSync(join(migrationsFolder, `${tag}.sql`), join(folder, `${tag}.sql`))
        }
      }
      writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(journal))
      migrateDatabase(sqlite, { migrationsFolder: folder })
      expect(sqlite.prepare("SELECT * FROM deep_search_web_pages WHERE deep_search_web_page_id='upgrade-page'").get()).toEqual({
        ...(pageBefore as object),
        captcha_task_id: null,
      })
      expect(sqlite.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all()).toEqual(triggersBefore)
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
    } finally {
      sqlite.close()
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it("accepts only NULL, the exact reservation sentinel, or a bounded nonblank task ID", () => {
    const prefix = crypto.randomUUID()
    const userId = `${prefix}-owner`
    const searchId = `${prefix}-search`
    insertUser(userId)
    insertSearch(searchId, userId)
    insertPage(`${prefix}-without-reservation`, searchId)
    insertPage(`${prefix}-reserved`, searchId)

    db.update(deepSearchWebPages)
      .set({ captchaTaskId: "" })
      .where(eq(deepSearchWebPages.deepSearchWebPageId, `${prefix}-reserved`))
      .run()
    expect(() => db.update(deepSearchWebPages)
      .set({ captchaTaskId: "   " })
      .where(eq(deepSearchWebPages.deepSearchWebPageId, `${prefix}-reserved`))
      .run()).toThrow(/deep_search_web_pages_captcha_task_check/)
    expect(() => db.update(deepSearchWebPages)
      .set({ captchaTaskId: "x".repeat(201) })
      .where(eq(deepSearchWebPages.deepSearchWebPageId, `${prefix}-reserved`))
      .run()).toThrow(/deep_search_web_pages_captcha_task_check/)
    expect(db.select({ captchaTaskId: deepSearchWebPages.captchaTaskId })
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchWebPageId, `${prefix}-reserved`))
      .get()).toEqual({ captchaTaskId: "" })
    db.update(deepSearchWebPages)
      .set({ captchaTaskId: "x".repeat(200) })
      .where(eq(deepSearchWebPages.deepSearchWebPageId, `${prefix}-reserved`))
      .run()
    expect(db.select({ captchaTaskId: deepSearchWebPages.captchaTaskId })
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchWebPageId, `${prefix}-reserved`))
      .get()?.captchaTaskId).toHaveLength(200)
    expect(db.select({ captchaTaskId: deepSearchWebPages.captchaTaskId })
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchWebPageId, `${prefix}-without-reservation`))
      .get()).toEqual({ captchaTaskId: null })
  })

  it("reserves once per page and registers the task ID idempotently", () => {
    const prefix = crypto.randomUUID()
    const userId = `${prefix}-owner`
    const searchId = `${prefix}-search`
    const pageId = `${prefix}-page`
    const unreservedPageId = `${prefix}-unreserved-page`
    insertUser(userId)
    insertSearch(searchId, userId)
    insertPage(pageId, searchId)
    insertPage(unreservedPageId, searchId)

    expect(() => registerCaptchaTask({
      userId,
      deepSearchJobId: searchId,
      pageId: unreservedPageId,
      taskId: "task-without-reservation",
    })).toThrow(/without a reserved attempt/)

    const first = reserveCaptchaAttempt({ userId, deepSearchJobId: searchId, pageId, maxTasksPerRootJob: 1 })
    const second = reserveCaptchaAttempt({ userId, deepSearchJobId: searchId, pageId, maxTasksPerRootJob: 1 })
    expect(first).toEqual({ created: true, taskId: null })
    expect(second).toEqual({ ...first, created: false })
    registerCaptchaTask({ userId, deepSearchJobId: searchId, pageId, taskId: " task-123 " })
    registerCaptchaTask({ userId, deepSearchJobId: searchId, pageId, taskId: "task-123" })
    expect(db.select({
      captchaTaskId: deepSearchWebPages.captchaTaskId,
    }).from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchWebPageId, pageId)).get()).toEqual({
        captchaTaskId: "task-123",
      })
    expect(() => registerCaptchaTask({ userId, deepSearchJobId: searchId, pageId, taskId: "other-task" }))
      .toThrow(/different CAPTCHA task/)
  })

  it("enforces the task budget across all searches in a debate subtree", () => {
    const prefix = crypto.randomUUID()
    const pageIds = insertDebateSubtree(prefix, 11)
    const userId = `${prefix}-owner`
    const searchIds = pageIds.map((_, index) => `${prefix}-search-${index}`)
    for (const [index, pageId] of pageIds.slice(0, 10).entries()) {
      const searchId = searchIds[index]
      if (!searchId) throw new Error("Expected child search")
      expect(reserveCaptchaAttempt({
        userId,
        deepSearchJobId: searchId,
        pageId,
        maxTasksPerRootJob: 10,
      }).created).toBe(true)
    }
    const lastPageId = pageIds[10]
    const lastSearchId = searchIds[10]
    if (!lastPageId || !lastSearchId) throw new Error("Expected eleventh child search")
    expect(() => reserveCaptchaAttempt({
      userId,
      deepSearchJobId: lastSearchId,
      pageId: lastPageId,
      maxTasksPerRootJob: 10,
    })).toThrow(/task budget.*reached/i)
  })

  it("counts unknown and known attempts across a standalone idea root without charging retries twice", () => {
    const prefix = crypto.randomUUID()
    const userId = `${prefix}-owner`
    const ideaId = `${prefix}-idea`
    insertUser(userId)
    db.insert(ideaJobs).values({
      ideaJobId: ideaId,
      userId,
      slug: `idea-${ideaId}`,
      prompt: "Research a set of ideas",
      numberOfIdeas: 1,
      deepSearchCount: 3,
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
    }).run()
    const pages = [0, 1, 2].map((index) => {
      const searchId = `${prefix}-search-${index}`
      const pageId = `${prefix}-page-${index}`
      insertSearch(searchId, userId, ideaId, index)
      insertPage(pageId, searchId)
      return { searchId, pageId }
    })
    const unknownPage = pages[0]
    const knownPage = pages[1]
    const overBudgetPage = pages[2]
    if (!unknownPage || !knownPage || !overBudgetPage) throw new Error("Expected three standalone-idea searches")

    expect(reserveCaptchaAttempt({
      userId,
      deepSearchJobId: unknownPage.searchId,
      pageId: unknownPage.pageId,
      maxTasksPerRootJob: 2,
    })).toEqual({ created: true, taskId: null })
    expect(reserveCaptchaAttempt({
      userId,
      deepSearchJobId: knownPage.searchId,
      pageId: knownPage.pageId,
      maxTasksPerRootJob: 2,
    })).toEqual({ created: true, taskId: null })
    registerCaptchaTask({
      userId,
      deepSearchJobId: knownPage.searchId,
      pageId: knownPage.pageId,
      taskId: "standalone-idea-task",
    })

    expect(reserveCaptchaAttempt({
      userId,
      deepSearchJobId: unknownPage.searchId,
      pageId: unknownPage.pageId,
      maxTasksPerRootJob: 2,
    })).toEqual({ created: false, taskId: null })
    expect(reserveCaptchaAttempt({
      userId,
      deepSearchJobId: knownPage.searchId,
      pageId: knownPage.pageId,
      maxTasksPerRootJob: 2,
    })).toEqual({ created: false, taskId: "standalone-idea-task" })
    expect(() => reserveCaptchaAttempt({
      userId,
      deepSearchJobId: overBudgetPage.searchId,
      pageId: overBudgetPage.pageId,
      maxTasksPerRootJob: 2,
    })).toThrow(/task budget.*reached/i)
  })

  it("rejects foreign pages, mismatched pages, and stopped roots", () => {
    const prefix = crypto.randomUUID()
    const ownerId = `${prefix}-owner`
    const otherId = `${prefix}-other`
    const searchId = `${prefix}-search`
    const pageId = `${prefix}-page`
    const otherSearchId = `${prefix}-other-search`
    const otherPageId = `${prefix}-other-page`
    insertUser(ownerId)
    insertUser(otherId)
    insertSearch(searchId, ownerId)
    insertPage(pageId, searchId)
    insertSearch(otherSearchId, ownerId)
    insertPage(otherPageId, otherSearchId)

    const input = { userId: ownerId, deepSearchJobId: searchId, pageId, maxTasksPerRootJob: 2 }
    expect(() => reserveCaptchaAttempt({ ...input, userId: otherId }))
      .toThrow(/not found or is not owned/)
    expect(() => reserveCaptchaAttempt({ ...input, pageId: `${prefix}-missing` }))
      .toThrow(/not found or is not owned/)
    expect(() => reserveCaptchaAttempt({ ...input, pageId: otherPageId }))
      .toThrow(/not found or is not owned/)
    expect(() => reserveCaptchaAttempt({ ...input, deepSearchJobId: `${prefix}-missing-search` }))
      .toThrow(/not found or is not owned/)

    db.update(deepSearchJobs)
      .set({ cancelRequestedAt: new Date() })
      .where(eq(deepSearchJobs.deepSearchJobId, searchId))
      .run()
    expect(() => reserveCaptchaAttempt(input)).toThrow(/stopped or inactive/)
  })

  it("records a known paid task ID after Stop races task creation", () => {
    const prefix = crypto.randomUUID()
    const userId = `${prefix}-owner`
    const searchId = `${prefix}-search`
    const pageId = `${prefix}-page`
    insertUser(userId)
    insertSearch(searchId, userId)
    insertPage(pageId, searchId)
    reserveCaptchaAttempt({ userId, deepSearchJobId: searchId, pageId, maxTasksPerRootJob: 1 })
    db.update(deepSearchJobs)
      .set({ cancelRequestedAt: new Date() })
      .where(eq(deepSearchJobs.deepSearchJobId, searchId))
      .run()
    registerCaptchaTask({ userId, deepSearchJobId: searchId, pageId, taskId: "paid-task-456" })
    expect(db.select({ captchaTaskId: deepSearchWebPages.captchaTaskId })
      .from(deepSearchWebPages)
      .where(and(
        eq(deepSearchWebPages.deepSearchWebPageId, pageId),
        eq(deepSearchWebPages.deepSearchJobId, searchId),
      )).get()).toEqual({ captchaTaskId: "paid-task-456" })
  })

  it("persists the reservation before CapSolver, resumes known tasks, and never repeats an uncertain purchase", async () => {
    const prefix = crypto.randomUUID()
    const userId = `${prefix}-owner`
    const searchId = `${prefix}-search`
    const successfulPageId = `${prefix}-successful-page`
    const uncertainPageId = `${prefix}-uncertain-page`
    insertUser(userId)
    insertSearch(searchId, userId)
    insertPage(successfulPageId, searchId)
    insertPage(uncertainPageId, searchId)
    const solverParams = (pageId: string) => ({
      challenge: { family: "turnstile" as const, websiteKey: "synthetic-site-key", widgetId: "widget-1" },
      userId,
      deepSearchJobId: searchId,
      pageId,
      url: "https://example.com/source",
      signal: new AbortController().signal,
    })
    let storedAtTaskCreation: { captchaTaskId: string | null } | undefined
    let createRequestKey: string | undefined
    const successfulFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (endpoint.endsWith("/createTask")) {
        storedAtTaskCreation = db.select({ captchaTaskId: deepSearchWebPages.captchaTaskId })
          .from(deepSearchWebPages)
          .where(eq(deepSearchWebPages.deepSearchWebPageId, successfulPageId)).get()
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as { clientKey?: string } : undefined
        createRequestKey = body?.clientKey
        return Promise.resolve(new Response(JSON.stringify({ errorId: 0, taskId: "persisted-task" })))
      }
      return Promise.resolve(new Response(JSON.stringify({
        errorId: 0,
        status: "ready",
        solution: { token: "synthetic-solution" },
      })))
    })

    const firstSolve = await solveCaptchaToken(solverParams(successfulPageId), {
      apiKey: "synthetic-test-key",
      fetch: successfulFetch,
    })
    expect(firstSolve).toEqual({
      outcome: { status: "solved", family: "turnstile" },
      token: "synthetic-solution",
    })
    expect(storedAtTaskCreation).toEqual({ captchaTaskId: "" })
    expect(createRequestKey).toBe("synthetic-test-key")
    expect(db.select({ captchaTaskId: deepSearchWebPages.captchaTaskId })
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchWebPageId, successfulPageId)).get())
      .toEqual({ captchaTaskId: "persisted-task" })

    const resumedFetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({
      errorId: 0,
      status: "ready",
      solution: { token: "resumed-solution" },
    }))))
    const resumedSolve = await solveCaptchaToken(solverParams(successfulPageId), {
      apiKey: "synthetic-test-key",
      fetch: resumedFetch,
    })
    expect(resumedSolve.token).toBe("resumed-solution")
    expect(resumedFetch).toHaveBeenCalledOnce()
    const resumedInput = resumedFetch.mock.calls[0]?.[0]
    const resumedUrl = typeof resumedInput === "string"
      ? resumedInput
      : resumedInput instanceof URL ? resumedInput.href : resumedInput?.url
    expect(resumedUrl).toContain("/getTaskResult")

    const uncertainFetch = vi.fn(() => Promise.resolve(new Response("unavailable", { status: 503 })))
    const uncertainSolve = await solveCaptchaToken(solverParams(uncertainPageId), {
      apiKey: "synthetic-test-key",
      fetch: uncertainFetch,
    })
    expect(uncertainSolve.outcome).toEqual({ status: "failed", reason: "solver-unavailable" })
    expect(db.select({ captchaTaskId: deepSearchWebPages.captchaTaskId })
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchWebPageId, uncertainPageId)).get())
      .toEqual({ captchaTaskId: "" })

    const retryFetch = vi.fn()
    const retrySolve = await solveCaptchaToken(solverParams(uncertainPageId), {
      apiKey: "synthetic-test-key",
      fetch: retryFetch,
    })
    expect(retrySolve.outcome).toEqual({ status: "failed", reason: "attempt-already-reserved" })
    expect(retryFetch).not.toHaveBeenCalled()
  })
})
