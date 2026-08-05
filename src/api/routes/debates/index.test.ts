import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "../../db/index.ts"
import { debateJobs as debateJobsTable, ideaJobs } from "../../db/schema/index.ts"
import { debateJobs } from "./index.ts"
import type { DebateJobManager } from "./manager.ts"
import { DEBATE_TOURNAMENT_FORMAT } from "./tournament.ts"

function createApp(): Hono {
  const app = new Hono()
  const manager: DebateJobManager = {
    start: vi.fn(),
    getLiveJob: vi.fn(),
  }
  debateJobs(app, manager)
  return app
}

describe("debate job routes", () => {
  beforeEach(() => {
    db.delete(ideaJobs).run()
  })

  it("lists newest debate summaries with their idea prompts", async () => {
    const olderIdeaJobId = crypto.randomUUID()
    const newerIdeaJobId = crypto.randomUUID()
    const olderDebateJobId = crypto.randomUUID()
    const newerDebateJobId = crypto.randomUUID()
    const olderCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const newerCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const newerCompletedAt = new Date("2026-01-02T01:00:00.000Z")

    db.insert(ideaJobs)
      .values([
        {
          ideaJobId: olderIdeaJobId,
          prompt: "Older prompt",
          numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
          deepSearchCount: 2,
        },
        {
          ideaJobId: newerIdeaJobId,
          prompt: "Newer prompt",
          numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
          deepSearchCount: 2,
        },
      ])
      .run()
    db.insert(debateJobsTable)
      .values([
        {
          debateJobId: olderDebateJobId,
          ideaJobId: olderIdeaJobId,
          randomSeed: 1,
          createdAt: olderCreatedAt,
        },
        {
          debateJobId: newerDebateJobId,
          ideaJobId: newerIdeaJobId,
          randomSeed: 2,
          stage: "final",
          status: "completed",
          createdAt: newerCreatedAt,
          completedAt: newerCompletedAt,
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
