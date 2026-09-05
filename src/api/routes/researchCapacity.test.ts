import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { and, count, eq, isNull } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { HTTPException } from "hono/http-exception"
import { beforeEach, describe, expect, it } from "vitest"

import { config } from "../config.ts"
import { db } from "../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs,
  llmGenerations,
  researchJobAdmissions,
} from "../db/schema/index.ts"
import { reserveRootResearchCapacity } from "./researchCapacity.ts"

type WalChildMessage = {
  type: string
  behavior?: unknown
  error?: unknown
  slug?: unknown
  status?: unknown
  table?: unknown
}

type WalChildMessageReader = {
  waitFor(type: string): Promise<WalChildMessage>
}

function createWalChildMessageReader(
  child: ChildProcess,
): WalChildMessageReader {
  const queued: WalChildMessage[] = []
  const waiters = new Map<
    string,
    Array<{
      reject(error: Error): void
      resolve(message: WalChildMessage): void
      timeout: NodeJS.Timeout
    }>
  >()
  let stderr = ""

  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk
  })
  child.on("message", (message: unknown) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message) ||
      typeof message.type !== "string"
    ) {
      return
    }
    const typedMessage = message as WalChildMessage
    const waiter = waiters.get(typedMessage.type)?.shift()
    if (!waiter) {
      queued.push(typedMessage)
      return
    }
    clearTimeout(waiter.timeout)
    waiter.resolve(typedMessage)
  })

  const rejectWaiters = (error: Error): void => {
    for (const pending of waiters.values()) {
      for (const waiter of pending) {
        clearTimeout(waiter.timeout)
        waiter.reject(error)
      }
    }
    waiters.clear()
  }
  child.once("error", (error) => {
    rejectWaiters(error)
  })
  child.once("exit", (code, signal) => {
    if (waiters.size === 0) return
    rejectWaiters(
      new Error(
        `WAL child exited before the expected message ` +
          `(code ${String(code)}, signal ${String(signal)}): ${stderr}`,
      ),
    )
  })

  return {
    waitFor(type) {
      const queuedIndex = queued.findIndex((message) => message.type === type)
      if (queuedIndex !== -1) {
        return Promise.resolve(queued.splice(queuedIndex, 1)[0])
      }
      return new Promise((resolve, reject) => {
        const pending = waiters.get(type) ?? []
        const waiter = {
          reject,
          resolve,
          timeout: setTimeout(() => {
            const index = pending.indexOf(waiter)
            if (index !== -1) pending.splice(index, 1)
            reject(
              new Error(
                `Timed out waiting for WAL child message ${type}; ` +
                  `queued ${JSON.stringify(queued)}: ${stderr}`,
              ),
            )
          }, 10_000),
        }
        pending.push(waiter)
        waiters.set(type, pending)
      })
    },
  }
}

function spawnWalChild(databasePath: string): ChildProcess {
  const deepSearchManagerUrl = new URL(
    "./deepSearch/manager.ts",
    import.meta.url,
  ).href
  const script = `
    const Database = (await import("better-sqlite3")).default
    const originalPrepare = Database.prototype.prepare
    const originalTransaction = Database.prototype.transaction

    Database.prototype.prepare = function (source) {
      const statement = originalPrepare.call(this, source)
      const normalized = String(source).trimStart().toLowerCase()
      const table = normalized.startsWith("insert") && normalized.includes("deep_search_jobs")
        ? "deep_search_jobs"
        : undefined
      if (table === undefined) return statement
      return new Proxy(statement, {
        get(target, property) {
          const value = Reflect.get(target, property, target)
          if (property === "run") {
            return (...args) => {
              process.send?.({ type: "write-attempt", table })
              return value.apply(target, args)
            }
          }
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    }
    Database.prototype.transaction = function (callback) {
      const transaction = originalTransaction.call(this, callback)
      const instrument = (behavior, run) => (...args) => {
        process.send?.({ type: "transaction-begin", behavior })
        return run(...args)
      }
      const wrapped = instrument("deferred", transaction)
      wrapped.deferred = instrument("deferred", transaction.deferred)
      wrapped.immediate = instrument("immediate", transaction.immediate)
      wrapped.exclusive = instrument("exclusive", transaction.exclusive)
      return wrapped
    }

    const { default: PQueue } = await import("p-queue")
    PQueue.prototype.add = function () {
      process.send?.({ type: "queue-blocked" })
      return new Promise(() => {})
    }

    const { createDeepSearchJobManager } = await import(${JSON.stringify(deepSearchManagerUrl)})
    const manager = createDeepSearchJobManager()

    process.on("message", async (message) => {
      if (message?.type === "slug") {
        try {
          const started = await manager.start("wal-user-id", {
            title: "WAL Title",
            researchRequest: "Verify serialized slug allocation",
            maxSearches: 1,
            maxResultsPerSearch: 1,
            maxRounds: 1,
            ideaJobId: "wal-idea-job",
            ideaJobPosition: 0,
          })
          process.send?.(
            { type: "slug-result", slug: started.slug },
            () => process.exit(0),
          )
        } catch (error) {
          process.send?.(
            {
              type: "slug-result",
              slug: null,
              error: error instanceof Error ? error.message : String(error),
            },
            () => process.exit(1),
          )
        }
      }
    })
    process.send?.({ type: "ready" })
  `

  return spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", script],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: databasePath,
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  )
}

async function releaseContendedWriter(
  sqlite: Database.Database,
  messages: WalChildMessageReader,
  child: ChildProcess,
  command: string,
  expectedWriteTable: string,
): Promise<unknown> {
  child.send?.({ type: command })
  const transaction = await messages.waitFor("transaction-begin")
  if (transaction.behavior !== "immediate") {
    const write = await messages.waitFor("write-attempt")
    expect(write.table).toBe(expectedWriteTable)
  }
  sqlite.exec("COMMIT")
  return transaction.behavior
}

describe("root research admission", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
    db.delete(deepSearchJobs).run()
    db.delete(researchJobAdmissions).run()
  })

  it("serializes slug allocation across WAL connections", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "rethinkloop-capacity-wal-"),
    )
    const databasePath = join(temporaryDirectory, "data.db")
    const sqlite = new Database(databasePath)
    let child: ChildProcess | undefined

    try {
      sqlite.pragma("foreign_keys = ON")
      expect(sqlite.pragma("journal_mode = WAL", { simple: true })).toBe("wal")
      migrate(drizzle(sqlite), {
        migrationsFolder: fileURLToPath(
          new URL("../drizzle", import.meta.url),
        ),
      })
      sqlite
        .prepare(
          `insert into user (id, name, email, email_verified)
           values (?, ?, ?, 1)`,
        )
        .run("wal-user-id", "WAL User", "wal-user@example.com")
      sqlite
        .prepare(
          `insert into idea_jobs (
             idea_job_id, user_id, title, slug, prompt, number_of_ideas,
             deep_search_count, max_searches, max_results_per_search, max_rounds
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "wal-idea-job",
          "wal-user-id",
          "WAL ideas",
          "wal-ideas",
          "Generate WAL ideas",
          8,
          2,
          1,
          1,
          1,
        )

      child = spawnWalChild(databasePath)
      const messages = createWalChildMessageReader(child)
      await messages.waitFor("ready")

      sqlite.exec("BEGIN IMMEDIATE")
      sqlite
        .prepare(
          `insert into deep_search_jobs (
             deep_search_job_id, user_id, title, slug, research_request,
             max_searches, max_results_per_search, strict_quality,
             status, error, completed_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "competing-deep-search",
          "wal-user-id",
          "WAL Title",
          "wal-title",
          "Competing slug allocation",
          1,
          1,
          0,
          "failed",
          "Competing fixture",
          Date.now(),
        )
      const slugBehavior = await releaseContendedWriter(
        sqlite,
        messages,
        child,
        "slug",
        "deep_search_jobs",
      )
      const slugResult = await messages.waitFor("slug-result")
      await messages.waitFor("queue-blocked")

      expect(slugBehavior).toBe("immediate")
      expect(slugResult).toMatchObject({ slug: "wal-title-2" })
      expect(
        sqlite
          .prepare(
            `select slug from deep_search_jobs
             where slug like 'wal-title%'
             order by slug`,
          )
          .all(),
      ).toEqual([{ slug: "wal-title" }, { slug: "wal-title-2" }])

      if (child.exitCode === null) await once(child, "exit")
      expect(child.exitCode).toBe(0)
    } finally {
      if (sqlite.inTransaction) sqlite.exec("ROLLBACK")
      if (
        child !== undefined &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        child.kill()
        await once(child, "exit")
      }
      sqlite.close()
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  }, 15_000)

  it("allows repeated reservations despite historical admissions without recording new ones", () => {
    const kinds = ["deep-search", "idea", "debate"] as const
    db.insert(researchJobAdmissions)
      .values(
        Array.from(
          { length: 60 },
          (_, position) => ({
            researchJobAdmissionId: `root-admission-${position}`,
            userId: "test-user-id",
            kind: kinds[position % kinds.length] ?? "deep-search",
          }),
        ),
      )
      .run()

    const historicalAdmissions = db.select().from(researchJobAdmissions).all()
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const release = reserveRootResearchCapacity("test-user-id")
      release()
    }

    expect(db.select().from(researchJobAdmissions).all()).toEqual(
      historicalAdmissions,
    )
  })

  it("still rejects a request when the user has no active-job capacity", () => {
    db.insert(deepSearchJobs)
      .values(
        Array.from(
          { length: config.deepSearch.maxActiveRootJobsPerUser },
          (_, position) => ({
            deepSearchJobId: `active-root-${position}`,
            userId: "test-user-id",
            title: `Active root ${position}`,
            slug: `active-root-${position}`,
            researchRequest: "Research this",
            maxSearches: 1,
            maxResultsPerSearch: 1,
            strictQuality: false,
          }),
        ),
      )
      .run()

    expect(() =>
      reserveRootResearchCapacity("test-user-id"),
    ).toThrow(HTTPException)
    expect(db.select().from(researchJobAdmissions).all()).toEqual([])
  })

  it("uses covering partial indexes for active-capacity counts", () => {
    const plans = [
      {
        indexName: "debate_jobs_active_user_idx",
        query: db
          .select({ value: count() })
          .from(debateJobs)
          .where(
            and(
              eq(debateJobs.userId, "test-user-id"),
              eq(debateJobs.status, "running"),
            ),
          ),
      },
      {
        indexName: "idea_jobs_active_standalone_user_idx",
        query: db
          .select({ value: count() })
          .from(ideaJobs)
          .where(
            and(
              eq(ideaJobs.userId, "test-user-id"),
              eq(ideaJobs.status, "running"),
              isNull(ideaJobs.debateJobId),
            ),
          ),
      },
      {
        indexName: "deep_search_jobs_active_standalone_user_idx",
        query: db
          .select({ value: count() })
          .from(deepSearchJobs)
          .where(
            and(
              eq(deepSearchJobs.userId, "test-user-id"),
              eq(deepSearchJobs.status, "running"),
              isNull(deepSearchJobs.ideaJobId),
            ),
          ),
      },
      {
        indexName: "llm_generations_active_standalone_user_idx",
        query: db
          .select({ value: count() })
          .from(llmGenerations)
          .where(
            and(
              eq(llmGenerations.userId, "test-user-id"),
              eq(llmGenerations.status, "running"),
              isNull(llmGenerations.debateJobId),
              isNull(llmGenerations.ideaJobId),
              isNull(llmGenerations.deepSearchJobId),
            ),
          ),
      },
    ]

    for (const { indexName, query } of plans) {
      const { sql, params } = query.toSQL()
      const rows = db.$client
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...params) as Array<{ detail: string }>
      expect(
        rows.some(({ detail }) =>
          detail.includes(`USING COVERING INDEX ${indexName}`),
        ),
      ).toBe(true)
    }
  })
})
