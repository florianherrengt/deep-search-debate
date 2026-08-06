import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "../../db/index.ts"
import { debateJobs as debateJobsTable, ideaJobs } from "../../db/schema/index.ts"
import { debateJobs } from "./index.ts"
import type { DebateJobManager } from "./manager.ts"
import { DEBATE_TOURNAMENT_FORMAT } from "./tournament.ts"
import type { AppEnv } from "../../types/auth.ts"

function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use("*", async (c, next) => {
    c.set("userId", "test-user-id")
    await next()
  })
  const manager: DebateJobManager = {
    start: vi.fn(),
    getLiveJob: vi.fn(),
  }
  debateJobs(app, manager)
  return app
}

describe("debate job routes", () => {
  beforeEach(() => {
    db.delete(debateJobsTable).run()
  })

  it("lists newest debate summaries with their idea prompts", async () => {
    const olderIdeaJobId = crypto.randomUUID()
    const newerIdeaJobId = crypto.randomUUID()
    const olderDebateJobId = "00000000-0000-4000-8000-000000000000"
    const newerDebateJobId = "ffffffff-ffff-4fff-bfff-ffffffffffff"
    const olderCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const newerCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const newerCompletedAt = new Date("2026-01-02T01:00:00.000Z")

    db.insert(debateJobsTable)
      .values([
        {
          userId: "test-user-id",
          debateJobId: olderDebateJobId,
          randomSeed: 1,
          createdAt: olderCreatedAt,
        },
        {
          userId: "test-user-id",
          debateJobId: newerDebateJobId,
          randomSeed: 2,
          stage: "final",
          status: "completed",
          createdAt: newerCreatedAt,
          completedAt: newerCompletedAt,
        },
      ])
      .run()
    db.insert(ideaJobs)
      .values([
        {
          userId: "test-user-id",
          ideaJobId: olderIdeaJobId,
          debateJobId: olderDebateJobId,
          prompt: "Older prompt",
          numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
          deepSearchCount: 2,
        },
        {
          userId: "test-user-id",
          ideaJobId: newerIdeaJobId,
          debateJobId: newerDebateJobId,
          prompt: "Newer prompt",
          numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
          deepSearchCount: 2,
        },
      ])
      .run()

    const response = await createApp().request("/debate-jobs?limit=1")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      debateJobs: [
        {
          debateJobId: newerDebateJobId,
          ideaJobId: newerIdeaJobId,
          prompt: "Newer prompt",
          stage: "final",
          status: "completed",
          error: null,
          createdAt: newerCreatedAt.toISOString(),
          completedAt: newerCompletedAt.toISOString(),
        },
      ],
    })
  })

  it("validates the history limit", async () => {
    const response = await createApp().request("/debate-jobs?limit=0")

    expect(response.status).toBe(400)
  })
})
