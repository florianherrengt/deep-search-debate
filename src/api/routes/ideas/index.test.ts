import { eq } from "drizzle-orm"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
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
  ideas as ideasTable,
  user as userTable,
} from "../../db/schema/index.ts"
import { writeIdeaSite, ideaSiteScreenshotPath } from "./ideaSites.ts"
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
    stop: vi.fn(),
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

async function writeIdeaSiteScreenshot(
  ideaId: string,
  png: Uint8Array,
): Promise<void> {
  const path = ideaSiteScreenshotPath(ideaId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, png)
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
      stop: vi.fn(),
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

  it("does not mix another user's public debate ideas into personal history", async () => {
    const debateJobId = crypto.randomUUID()
    db.insert(userTable)
      .values({
        email: "other-user@example.com",
        emailVerified: true,
        id: "other-user-id",
        name: "Other User",
      })
      .onConflictDoNothing()
      .run()
    db.insert(debateJobs)
      .values({
        debateJobId,
        isPublic: true,
        randomSeed: 1,
        userId: "other-user-id",
      })
      .run()
    db.insert(ideaJobsTable)
      .values({
        debateJobId,
        deepSearchCount: 2,
        ideaJobId: crypto.randomUUID(),
        numberOfIdeas: 12,
        prompt: "Foreign public ideas",
        slug: "foreign-public-ideas",
        userId: "other-user-id",
      })
      .run()

    await expect(
      (await createApp().request("/idea-jobs")).json(),
    ).resolves.toEqual({ ideaJobs: [] })
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
      stop: vi.fn(),
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
      stop: vi.fn(),
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

  it("stops a root without a live controller and replays the exact suffix", async () => {
    const ideaJobId = crypto.randomUUID()
    db.insert(ideaJobsTable)
      .values({
        ideaJobId,
        userId: "test-user-id",
        title: "Stoppable ideas",
        slug: "stoppable-ideas",
        prompt: "Generate stoppable ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()
    const app = createApp()

    const first = await app.request(`/idea-jobs/${ideaJobId}/cancel`, {
      method: "POST",
    })
    expect(first.status).toBe(202)
    await expect(first.json()).resolves.toMatchObject({
      status: "cancellation-requested",
    })
    expect(db.select().from(ideaJobsTable).get()).toMatchObject({
      status: "interrupted",
      error: "Workflow stopped by user",
    })

    const repeat = await app.request(`/idea-jobs/${ideaJobId}/cancel`, {
      method: "POST",
    })
    expect(repeat.status).toBe(200)
    await expect(repeat.json()).resolves.toMatchObject({ status: "interrupted" })

    const events = await app.request(`/idea-jobs/${ideaJobId}/events`)
    await expect(readEvents(events)).resolves.toEqual([
      { type: "stop-requested" },
      { type: "interrupted", message: "Workflow stopped by user" },
      { type: "done" },
    ])
  })

  it("persists Stop before aborting the active manager controller", async () => {
    let persistedBeforeAbort = false
    mocks.runIdeaJob.mockImplementation(
      ({
        ideaJobId,
        workflowSignal,
      }: {
        ideaJobId: string
        workflowSignal: AbortSignal
      }) =>
        new Promise<void>((resolve) => {
          workflowSignal.addEventListener(
            "abort",
            () => {
              persistedBeforeAbort =
                db
                  .select({
                    cancelRequestedAt: ideaJobsTable.cancelRequestedAt,
                  })
                  .from(ideaJobsTable)
                  .where(eq(ideaJobsTable.ideaJobId, ideaJobId))
                  .get()?.cancelRequestedAt instanceof Date
              db.update(ideaJobsTable)
                .set({
                  status: "interrupted",
                  error: "Workflow stopped by user",
                  completedAt: new Date(),
                })
                .where(eq(ideaJobsTable.ideaJobId, ideaJobId))
                .run()
              resolve()
            },
            { once: true },
          )
        }),
    )
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const app = createApp()
    const created = await app.request("/idea-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Generate ideas" }),
    })
    const { ideaJobId } = (await created.json()) as { ideaJobId: string }

    const stopped = await app.request(`/idea-jobs/${ideaJobId}/cancel`, {
      method: "POST",
    })

    expect(stopped.status).toBe(202)
    expect(persistedBeforeAbort).toBe(true)
  })

  it("returns 404 for another owner's root", async () => {
    db.insert(userTable)
      .values({
        email: "stop-owner@example.com",
        emailVerified: true,
        id: "stop-owner-id",
        name: "Stop Owner",
      })
      .onConflictDoNothing()
      .run()
    const ideaJobId = crypto.randomUUID()
    db.insert(ideaJobsTable)
      .values({
        ideaJobId,
        userId: "stop-owner-id",
        title: "Foreign ideas",
        slug: "foreign-stop-ideas",
        prompt: "Generate foreign ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()

    const response = await createApp().request(
      `/idea-jobs/${ideaJobId}/cancel`,
      { method: "POST" },
    )

    expect(response.status).toBe(404)
  })

  it("projects root Stop state and rejects debate-owned descendants", async () => {
    const rootIdeaJobId = crypto.randomUUID()
    const debateJobId = crypto.randomUUID()
    db.insert(ideaJobsTable)
      .values({
        ideaJobId: rootIdeaJobId,
        userId: "test-user-id",
        title: "Root ideas",
        slug: "root-ideas",
        prompt: "Generate root ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()
    db.insert(debateJobs)
      .values({ debateJobId, randomSeed: 1, userId: "test-user-id" })
      .run()
    const nestedIdeaJobId = crypto.randomUUID()
    db.insert(ideaJobsTable)
      .values({
        debateJobId,
        ideaJobId: nestedIdeaJobId,
        userId: "test-user-id",
        title: "Nested ideas",
        slug: "nested-ideas",
        prompt: "Generate nested ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()
    const app = createApp()

    const detail = await app.request("/idea-jobs/root-ideas")
    await expect(detail.json()).resolves.toMatchObject({
      ideaJob: { canStop: true, stopRequested: false },
    })
    const history = await app.request("/idea-jobs")
    const historyBody = (await history.json()) as {
      ideaJobs: Array<{ ideaJobId: string; stopRequested: boolean }>
    }
    expect(
      historyBody.ideaJobs.find(({ ideaJobId }) => ideaJobId === rootIdeaJobId),
    ).toMatchObject({
      ideaJobId: rootIdeaJobId,
      stopRequested: false,
    })

    const nestedStop = await app.request(
      `/idea-jobs/${nestedIdeaJobId}/cancel`,
      { method: "POST" },
    )
    expect(nestedStop.status).toBe(409)
  })

  it("serves a generated idea website to the owning reader", async () => {
    const ideaJobId = crypto.randomUUID()
    const ideaId = crypto.randomUUID()
    db.insert(ideaJobsTable)
      .values({
        ideaJobId,
        userId: "test-user-id",
        title: "Owned ideas",
        slug: "owned-ideas",
        prompt: "Generate ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()
    db.insert(ideasTable)
      .values({
        ideaJobId,
        ideaId,
        position: 0,
        title: "First idea",
        description: "First description",
        selected: true,
      })
      .run()
    const html = "<!DOCTYPE html><html><body>Owned idea site</body></html>"
    await writeIdeaSite(ideaId, html)

    const response = await createApp().request(
      `/idea-jobs/${ideaJobId}/ideas/${ideaId}/website`,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8")
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "sandbox allow-scripts",
    )
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    await expect(response.text()).resolves.toBe(html)
  })

  it("serves a public debate's idea website to another reader", async () => {
    const ideaJobId = crypto.randomUUID()
    const ideaId = crypto.randomUUID()
    const debateJobId = crypto.randomUUID()
    db.insert(userTable)
      .values({
        email: "other-user@example.com",
        emailVerified: true,
        id: "other-user-id",
        name: "Other User",
      })
      .onConflictDoNothing()
      .run()
    db.insert(debateJobs)
      .values({ debateJobId, isPublic: true, randomSeed: 1, userId: "other-user-id" })
      .run()
    db.insert(ideaJobsTable)
      .values({
        debateJobId,
        ideaJobId,
        userId: "other-user-id",
        title: "Public ideas",
        slug: "public-ideas",
        prompt: "Generate public ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()
    db.insert(ideasTable)
      .values({
        ideaJobId,
        ideaId,
        position: 0,
        title: "Public idea",
        description: "Public description",
        selected: true,
      })
      .run()
    await writeIdeaSite(ideaId, "<!DOCTYPE html><html><body>Public</body></html>")

    const response = await createApp().request(
      `/idea-jobs/${ideaJobId}/ideas/${ideaId}/website`,
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe(
      "<!DOCTYPE html><html><body>Public</body></html>",
    )
  })

  it("returns 404 for a website that was never generated", async () => {
    const ideaJobId = crypto.randomUUID()
    const ideaId = crypto.randomUUID()
    db.insert(ideaJobsTable)
      .values({
        ideaJobId,
        userId: "test-user-id",
        title: "Missing website",
        slug: "missing-website",
        prompt: "Generate ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()
    db.insert(ideasTable)
      .values({
        ideaJobId,
        ideaId,
        position: 0,
        title: "First idea",
        description: "First description",
      })
      .run()

    const response = await createApp().request(
      `/idea-jobs/${ideaJobId}/ideas/${ideaId}/website`,
    )

    expect(response.status).toBe(404)
  })

  it("does not disclose a foreign private idea website", async () => {
    const ideaJobId = crypto.randomUUID()
    const ideaId = crypto.randomUUID()
    db.insert(userTable)
      .values({
        email: "other-user@example.com",
        emailVerified: true,
        id: "other-user-id",
        name: "Other User",
      })
      .onConflictDoNothing()
      .run()
    db.insert(ideaJobsTable)
      .values({
        ideaJobId,
        userId: "other-user-id",
        title: "Foreign private ideas",
        slug: "foreign-private-ideas",
        prompt: "Generate private ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()
    db.insert(ideasTable)
      .values({
        ideaJobId,
        ideaId,
        position: 0,
        title: "Foreign idea",
        description: "Foreign description",
        selected: true,
      })
      .run()
    await writeIdeaSite(ideaId, "<!DOCTYPE html><html><body>Foreign</body></html>")

    const response = await createApp().request(
      `/idea-jobs/${ideaJobId}/ideas/${ideaId}/website`,
    )

    expect(response.status).toBe(404)
  })

  it("returns 404 for an idea outside the requested job", async () => {
    const ideaJobId = crypto.randomUUID()
    db.insert(ideaJobsTable)
      .values({
        ideaJobId,
        userId: "test-user-id",
        title: "Unrelated ideas",
        slug: "unrelated-ideas",
        prompt: "Generate ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()
    const foreignIdeaId = crypto.randomUUID()
    await writeIdeaSite(
      foreignIdeaId,
      "<!DOCTYPE html><html><body>Unrelated</body></html>",
    )

    const response = await createApp().request(
      `/idea-jobs/${ideaJobId}/ideas/${foreignIdeaId}/website`,
    )

    expect(response.status).toBe(404)
  })

  it("serves the captured screenshot to the owning reader", async () => {
    const ideaJobId = crypto.randomUUID()
    const ideaId = crypto.randomUUID()
    db.insert(ideaJobsTable)
      .values({
        ideaJobId,
        userId: "test-user-id",
        title: "Screenshot ideas",
        slug: "screenshot-ideas",
        prompt: "Generate ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()
    db.insert(ideasTable)
      .values({
        ideaJobId,
        ideaId,
        position: 0,
        title: "First idea",
        description: "First description",
        selected: true,
      })
      .run()
    const png = new Uint8Array([1, 2, 3])
    await writeIdeaSiteScreenshot(ideaId, png)

    const response = await createApp().request(
      `/idea-jobs/${ideaJobId}/ideas/${ideaId}/website/screenshot.png`,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("image/png")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png)
  })

  it("returns 404 for a screenshot that was never captured", async () => {
    const ideaJobId = crypto.randomUUID()
    const ideaId = crypto.randomUUID()
    db.insert(ideaJobsTable)
      .values({
        ideaJobId,
        userId: "test-user-id",
        title: "No screenshot ideas",
        slug: "no-screenshot-ideas",
        prompt: "Generate ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()
    db.insert(ideasTable)
      .values({
        ideaJobId,
        ideaId,
        position: 0,
        title: "First idea",
        description: "First description",
        selected: true,
      })
      .run()

    const response = await createApp().request(
      `/idea-jobs/${ideaJobId}/ideas/${ideaId}/website/screenshot.png`,
    )

    expect(response.status).toBe(404)
  })

  it("does not disclose a foreign private idea screenshot", async () => {
    const ideaJobId = crypto.randomUUID()
    const ideaId = crypto.randomUUID()
    db.insert(userTable)
      .values({
        email: "other-user@example.com",
        emailVerified: true,
        id: "other-user-id",
        name: "Other User",
      })
      .onConflictDoNothing()
      .run()
    db.insert(ideaJobsTable)
      .values({
        ideaJobId,
        userId: "other-user-id",
        title: "Foreign screenshot ideas",
        slug: "foreign-screenshot-ideas",
        prompt: "Generate private ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
      })
      .run()
    db.insert(ideasTable)
      .values({
        ideaJobId,
        ideaId,
        position: 0,
        title: "Foreign idea",
        description: "Foreign description",
        selected: true,
      })
      .run()
    await writeIdeaSiteScreenshot(ideaId, new Uint8Array([1]))

    const response = await createApp().request(
      `/idea-jobs/${ideaJobId}/ideas/${ideaId}/website/screenshot.png`,
    )

    expect(response.status).toBe(404)
  })
})
