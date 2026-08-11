import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generatePromptTitle: vi.fn().mockResolvedValue("Generate Ideas"),
  runIdeaJob: vi.fn(),
}))

vi.mock("./run.ts", () => ({ runIdeaJob: mocks.runIdeaJob }))
vi.mock("../../llms/generateText.ts", () => ({
  generatePromptTitle: mocks.generatePromptTitle,
}))

import { db } from "../../db/index.ts"
import { config } from "../../config.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs as ideaJobsTable,
} from "../../db/schema/index.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { ideaJobReads, ideaJobs, type IdeaJobEvent } from "./index.ts"
import { createIdeaJobManager } from "./manager.ts"
import type { LiveIdeaJob } from "./schemas.ts"
import type { AppEnv } from "../../types/auth.ts"

function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use("*", async (c, next) => {
    c.set("userId", "test-user-id")
    c.set("viewerUserId", "test-user-id")
    await next()
  })
  const manager: DeepSearchJobManager = {
    start: vi.fn(),
    requireParentQualityAcceptance: vi.fn(),
    getLiveJob: vi.fn(),
  }
  const ideaJobManager = createIdeaJobManager(manager)
  ideaJobReads(app, ideaJobManager)
  ideaJobs(app, ideaJobManager)
  return app
}

async function readEvents(response: Response): Promise<IdeaJobEvent[]> {
  return (await response.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IdeaJobEvent)
}

describe("idea job routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.delete(debateJobs).run()
    db.delete(ideaJobsTable).run()
    db.delete(deepSearchJobs).run()
  })

  it("guards internal idea-job starts before creating a job", async () => {
    const deepSearchManager: DeepSearchJobManager = {
      start: vi.fn(),
      requireParentQualityAcceptance: vi.fn(),
      getLiveJob: vi.fn(),
    }
    const manager = createIdeaJobManager(deepSearchManager)

    await expect(
      manager.start("test-user-id", {
        prompt: "Generate ideas",
        numberOfIdeas: 12,
        deepSearchCount: 11,
        maxSearches: 3,
        maxResultsPerSearch: 3,
      }),
    ).rejects.toThrow("deepSearchCount")
    expect(mocks.generatePromptTitle).not.toHaveBeenCalled()
    expect(mocks.runIdeaJob).not.toHaveBeenCalled()
    expect(db.select().from(ideaJobsTable).all()).toEqual([])
  })

  it("rejects an excessive number of initial child searches", async () => {
    const response = await createApp().request("/idea-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Generate ideas",
        deepSearchCount: 11,
      }),
    })

    expect(response.status).toBe(400)
    expect(mocks.generatePromptTitle).not.toHaveBeenCalled()
    expect(mocks.runIdeaJob).not.toHaveBeenCalled()
  })

  it("returns 429 when the user already has the active root-job limit", async () => {
    db.insert(deepSearchJobs)
      .values(
        Array.from(
          { length: config.deepSearch.maxActiveRootJobsPerUser },
          (_, position) => ({
            deepSearchJobId: `active-search-${position}`,
            userId: "test-user-id",
            title: `Active search ${position}`,
            slug: `active-search-${position}`,
            researchRequest: "Research this",
            maxSearches: 3,
            maxResultsPerSearch: 3,
          }),
        ),
      )
      .run()

    const response = await createApp().request("/idea-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Generate ideas" }),
    })

    expect(response.status).toBe(429)
    expect(mocks.generatePromptTitle).not.toHaveBeenCalled()
    expect(mocks.runIdeaJob).not.toHaveBeenCalled()
  })

  it("counts running debates after their child idea jobs have settled", async () => {
    const rows = Array.from(
      { length: config.deepSearch.maxActiveRootJobsPerUser },
      (_, position) => ({
        debateJobId: `active-debate-${position}`,
        userId: "test-user-id",
        randomSeed: position,
      }),
    )
    db.insert(debateJobs).values(rows).run()
    db.insert(ideaJobsTable)
      .values(
        rows.map(({ debateJobId }, position) => ({
          ideaJobId: `settled-ideas-${position}`,
          userId: "test-user-id",
          debateJobId,
          title: `Settled ideas ${position}`,
          slug: `settled-ideas-${position}`,
          prompt: "Generate ideas",
          numberOfIdeas: 6,
          deepSearchCount: 2,
          status: "failed" as const,
          error: "Settled before the tournament",
          completedAt: new Date(),
        })),
      )
      .run()

    const response = await createApp().request("/idea-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Generate more ideas" }),
    })

    expect(response.status).toBe(429)
    expect(mocks.generatePromptTitle).not.toHaveBeenCalled()
  })

  it("reserves root capacity before generating an asynchronous title", async () => {
    db.insert(deepSearchJobs)
      .values(
        Array.from(
          {
            length: config.deepSearch.maxActiveRootJobsPerUser - 1,
          },
          (_, position) => ({
            deepSearchJobId: `existing-search-${position}`,
            userId: "test-user-id",
            title: `Existing search ${position}`,
            slug: `existing-search-${position}`,
            researchRequest: "Research this",
            maxSearches: 3,
            maxResultsPerSearch: 3,
          }),
        ),
      )
      .run()
    const title = Promise.withResolvers<string>()
    const workflow = Promise.withResolvers<void>()
    let startedIdeaJobId: string | undefined
    mocks.generatePromptTitle.mockReturnValueOnce(title.promise)
    mocks.runIdeaJob.mockImplementation(({ ideaJobId }: { ideaJobId: string }) => {
      startedIdeaJobId = ideaJobId
      return workflow.promise
    })
    const manager = createIdeaJobManager({
      start: vi.fn(),
      requireParentQualityAcceptance: vi.fn(),
      getLiveJob: vi.fn(),
    })

    const first = manager.start("test-user-id", {
      prompt: "First idea request",
      numberOfIdeas: 12,
      deepSearchCount: 2,
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })
    await vi.waitFor(() => {
      expect(mocks.generatePromptTitle).toHaveBeenCalledOnce()
    })

    await expect(
      manager.start("test-user-id", {
        prompt: "Second idea request",
        numberOfIdeas: 12,
        deepSearchCount: 2,
        maxSearches: 3,
        maxResultsPerSearch: 3,
      }),
    ).rejects.toMatchObject({ status: 429 })
    expect(mocks.generatePromptTitle).toHaveBeenCalledOnce()

    title.resolve("First Idea Request")
    const started = await first
    if (!startedIdeaJobId) throw new Error("Idea workflow did not start")
    db.update(ideaJobsTable)
      .set({
        status: "failed",
        error: "Stopped for admission test",
        completedAt: new Date(),
      })
      .where(eq(ideaJobsTable.ideaJobId, startedIdeaJobId))
      .run()
    workflow.resolve()
    await expect(started.completion).rejects.toThrow(
      "Stopped for admission test",
    )
  })

  it("rolls back the idea row and does not start work when owner creation fails", async () => {
    const deepSearchManager: DeepSearchJobManager = {
      start: vi.fn(),
      requireParentQualityAcceptance: vi.fn(),
      getLiveJob: vi.fn(),
    }
    const manager = createIdeaJobManager(deepSearchManager)

    await expect(
      manager.start(
        "test-user-id",
        {
          prompt: "Generate owned ideas",
          numberOfIdeas: 12,
          deepSearchCount: 2,
          maxSearches: 3,
          maxResultsPerSearch: 3,
        },
        {
          createParent: () => {
            throw new Error("Owner row failed")
          },
        },
      ),
    ).rejects.toThrow("Owner row failed")
    expect(db.select().from(ideaJobsTable).all()).toEqual([])
    expect(mocks.runIdeaJob).not.toHaveBeenCalled()
  })

  it("evicts a terminal live log and replays the durable job", async () => {
    mocks.runIdeaJob.mockImplementation(({ job }: { job: LiveIdeaJob }) => {
      job.publish({
        type: "error",
        message: "Live-only error",
        stage: "planning",
      })
      db.update(ideaJobsTable)
        .set({
          status: "failed",
          error: "Persisted error",
          completedAt: new Date(),
        })
        .run()
      job.publish({ type: "done" })
      job.close()
      return Promise.resolve()
    })
    const app = createApp()
    const created = await app.request("/idea-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Generate ideas" }),
    })
    const { ideaJobId } = (await created.json()) as { ideaJobId: string }
    await Promise.resolve()

    const response = await app.request(`/idea-jobs/${ideaJobId}/events`)

    await expect(readEvents(response)).resolves.toEqual([
      { type: "error", message: "Persisted error", stage: "planning" },
      { type: "done" },
    ])
  })

  it("retains its terminal live log when durable terminal persistence failed", async () => {
    mocks.runIdeaJob.mockImplementation(({ job }: { job: LiveIdeaJob }) => {
      job.publish({
        type: "error",
        message: "SQLite unavailable",
        stage: "planning",
      })
      job.publish({ type: "done" })
      job.close()
      return Promise.resolve()
    })
    const app = createApp()
    const created = await app.request("/idea-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Generate ideas" }),
    })
    const { ideaJobId } = (await created.json()) as { ideaJobId: string }
    await Promise.resolve()

    const response = await app.request(`/idea-jobs/${ideaJobId}/events`)

    await expect(readEvents(response)).resolves.toEqual([
      {
        type: "error",
        message: "SQLite unavailable",
        stage: "planning",
      },
      { type: "done" },
    ])
  })
})
