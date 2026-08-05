import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ runIdeaJob: vi.fn() }))

vi.mock("./run.ts", () => ({ runIdeaJob: mocks.runIdeaJob }))

import { db } from "../../db/index.ts"
import { ideaJobs as ideaJobsTable } from "../../db/schema/index.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { ideaJobs, type IdeaJobEvent } from "./index.ts"
import { createIdeaJobManager } from "./manager.ts"
import type { LiveIdeaJob } from "./schemas.ts"

function createApp(): Hono {
  const app = new Hono()
  const manager: DeepSearchJobManager = {
    start: vi.fn(),
    getLiveJob: vi.fn(),
  }
  ideaJobs(app, createIdeaJobManager(manager))
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
    db.delete(ideaJobsTable).run()
  })

  it("rolls back the idea row and does not start work when owner creation fails", () => {
    const deepSearchManager: DeepSearchJobManager = {
      start: vi.fn(),
      getLiveJob: vi.fn(),
    }
    const manager = createIdeaJobManager(deepSearchManager)

    expect(() =>
      manager.start(
        {
          prompt: "Generate owned ideas",
          numberOfIdeas: 12,
          deepSearchCount: 2,
          maxSearches: 3,
          maxResultsPerSearch: 3,
        },
        {
          createRelated: () => {
            throw new Error("Owner row failed")
          },
        },
      ),
    ).toThrow("Owner row failed")
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
