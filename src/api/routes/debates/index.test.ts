import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "../../db/index.ts"
import {
  debateJobs as debateJobsTable,
  ideaJobs,
  user as userTable,
} from "../../db/schema/index.ts"
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

  it("rejects an oversized research prompt", async () => {
    const start = vi.fn()
    const manager: DebateJobManager = {
      start,
      getLiveJob: vi.fn(),
    }
    const app = new Hono<AppEnv>()
    app.use("*", async (c, next) => {
      c.set("userId", "test-user-id")
      await next()
    })
    debateJobs(app, manager)

    const response = await app.request("/debate-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x".repeat(10_001) }),
    })

    expect(response.status).toBe(400)
    expect(start).not.toHaveBeenCalled()
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
          slug: "older-ideas",
          prompt: "Older prompt",
          numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
          deepSearchCount: 2,
        },
        {
          userId: "test-user-id",
          ideaJobId: newerIdeaJobId,
          debateJobId: newerDebateJobId,
          slug: "newer-ideas",
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
          title: "Untitled",
          slug: "newer-ideas",
          prompt: "Newer prompt",
          isPublic: false,
          stage: "final",
          status: "completed",
          error: null,
          createdAt: newerCreatedAt.toISOString(),
          completedAt: newerCompletedAt.toISOString(),
        },
      ],
    })
  })

  it("does not mix another user's public debates into personal history", async () => {
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
    db.insert(debateJobsTable)
      .values({
        debateJobId,
        isPublic: true,
        randomSeed: 1,
        userId: "other-user-id",
      })
      .run()
    db.insert(ideaJobs)
      .values({
        debateJobId,
        deepSearchCount: 2,
        ideaJobId: crypto.randomUUID(),
        numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
        prompt: "A public debate owned by somebody else",
        slug: "foreign-public-debate",
        userId: "other-user-id",
      })
      .run()

    await expect(
      (await createApp().request("/debate-jobs")).json(),
    ).resolves.toEqual({ debateJobs: [] })
  })

  it("validates the history limit", async () => {
    const response = await createApp().request("/debate-jobs?limit=0")

    expect(response.status).toBe(400)
  })

  it("lets the owner change debate visibility", async () => {
    const debateJobId = crypto.randomUUID()
    db.insert(debateJobsTable)
      .values({
        userId: "test-user-id",
        debateJobId,
        randomSeed: 1,
      })
      .run()

    const response = await createApp().request(
      `/debate-jobs/${debateJobId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: true }),
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ isPublic: true })
    expect(
      db
        .select({ isPublic: debateJobsTable.isPublic })
        .from(debateJobsTable)
        .where(eq(debateJobsTable.debateJobId, debateJobId))
        .get()?.isPublic,
    ).toBe(true)
  })

  it("does not revoke public access while a debate is running", async () => {
    const debateJobId = crypto.randomUUID()
    db.insert(debateJobsTable)
      .values({
        userId: "test-user-id",
        debateJobId,
        randomSeed: 1,
        isPublic: true,
      })
      .run()

    const response = await createApp().request(
      `/debate-jobs/${debateJobId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: false }),
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "A public debate cannot be made private while it is running",
    })
    expect(
      db
        .select({ isPublic: debateJobsTable.isPublic })
        .from(debateJobsTable)
        .where(eq(debateJobsTable.debateJobId, debateJobId))
        .get()?.isPublic,
    ).toBe(true)
  })

  it("lets the owner revoke public access after a debate finishes", async () => {
    const debateJobId = crypto.randomUUID()
    db.insert(debateJobsTable)
      .values({
        userId: "test-user-id",
        debateJobId,
        randomSeed: 1,
        isPublic: true,
        stage: "final",
        status: "completed",
        completedAt: new Date(),
      })
      .run()

    const response = await createApp().request(
      `/debate-jobs/${debateJobId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: false }),
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ isPublic: false })
  })

  it("rejects an empty debate update", async () => {
    const response = await createApp().request(
      `/debate-jobs/${crypto.randomUUID()}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    )

    expect(response.status).toBe(400)
  })
})
