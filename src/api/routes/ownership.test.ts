import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "../db/index.ts"
import {
  debateJobs as debateJobsTable,
  deepSearchJobs as deepSearchJobsTable,
  ideaJobs as ideaJobsTable,
  llmGenerations,
  user,
} from "../db/schema/index.ts"
import type { AppEnv } from "../types/auth.ts"
import { debateJobReads, debateJobs } from "./debates/index.ts"
import type { DebateJobManager } from "./debates/manager.ts"
import { deepSearchJobReads, deepSearchJobs } from "./deepSearch/index.ts"
import type { DeepSearchJobManager } from "./deepSearch/manager.ts"
import { ideaJobReads, ideaJobs } from "./ideas/index.ts"
import type { IdeaJobManager } from "./ideas/manager.ts"
import { streamReads, streams } from "./streams.ts"

const ownerId = "test-user-id"
const foreignUserId = "foreign-test-user-id"
const foreignIdeaJobId = "11111111-1111-4111-8111-111111111111"
const foreignDeepSearchJobId = "22222222-2222-4222-8222-222222222222"
const foreignDebateJobId = "33333333-3333-4333-8333-333333333333"
const foreignStreamId = "44444444-4444-4444-8444-444444444444"
const foreignDebateStreamId = "88888888-8888-4888-8888-888888888888"
const foreignIdeaStreamId = "99999999-9999-4999-8999-999999999999"
const foreignSearchStreamId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

const deepSearchStart = vi.fn<DeepSearchJobManager["start"]>(() => ({
  deepSearchJobId: "55555555-5555-4555-8555-555555555555",
  completion: Promise.resolve("answer"),
}))
const ideaStart = vi.fn<IdeaJobManager["start"]>(() => ({
  ideaJobId: "66666666-6666-4666-8666-666666666666",
  completion: Promise.resolve(),
}))
const debateStart = vi.fn<DebateJobManager["start"]>(() => ({
  debateJobId: "77777777-7777-4777-8777-777777777777",
  completion: Promise.resolve(),
}))

function createApp(viewerUserId: string | null = ownerId): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use("*", async (c, next) => {
    c.set("viewerUserId", viewerUserId)
    if (viewerUserId !== null) c.set("userId", viewerUserId)
    await next()
  })
  streamReads(app)
  deepSearchJobReads(app, {
    start: deepSearchStart,
    getLiveJob: () => undefined,
  })
  ideaJobReads(app, { start: ideaStart, getLiveJob: () => undefined })
  debateJobReads(app, { start: debateStart, getLiveJob: () => undefined })
  streams(app)
  deepSearchJobs(app, {
    start: deepSearchStart,
    getLiveJob: () => undefined,
  })
  ideaJobs(app, { start: ideaStart, getLiveJob: () => undefined })
  debateJobs(app, { start: debateStart, getLiveJob: () => undefined })
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  db.delete(user).where(eq(user.id, foreignUserId)).run()
  db.insert(user)
    .values({
      id: foreignUserId,
      name: "Foreign User",
      email: "foreign-user@example.com",
      emailVerified: true,
    })
    .run()
  db.insert(llmGenerations)
    .values({ userId: foreignUserId, llmGenerationId: foreignStreamId })
    .run()
  db.insert(debateJobsTable)
    .values({
      userId: foreignUserId,
      debateJobId: foreignDebateJobId,
      randomSeed: 1,
    })
    .run()
  db.insert(ideaJobsTable)
    .values({
      userId: foreignUserId,
      ideaJobId: foreignIdeaJobId,
      debateJobId: foreignDebateJobId,
      prompt: "Foreign ideas",
      numberOfIdeas: 12,
      deepSearchCount: 2,
    })
    .run()
  db.insert(deepSearchJobsTable)
    .values({
      userId: foreignUserId,
      deepSearchJobId: foreignDeepSearchJobId,
      ideaJobId: foreignIdeaJobId,
      ideaJobPosition: 0,
      researchRequest: "Foreign research",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })
    .run()
  db.insert(llmGenerations)
    .values(
      [
        {
          userId: foreignUserId,
          llmGenerationId: foreignDebateStreamId,
          debateJobId: foreignDebateJobId,
        },
        {
          userId: foreignUserId,
          llmGenerationId: foreignIdeaStreamId,
          ideaJobId: foreignIdeaJobId,
        },
        {
          userId: foreignUserId,
          llmGenerationId: foreignSearchStreamId,
          deepSearchJobId: foreignDeepSearchJobId,
        },
      ].map((generation) => ({
        ...generation,
        status: "completed" as const,
        text: "Public output",
        reasoning: "",
        completedAt: new Date(),
      })),
    )
    .run()
})

describe("user-owned routes", () => {
  it.each([
    ["stream", `/streams/${foreignStreamId}`],
    ["deep-search detail", `/deep-search-jobs/${foreignDeepSearchJobId}`],
    ["deep-search events", `/deep-search-jobs/${foreignDeepSearchJobId}/events`],
    ["idea detail", `/idea-jobs/${foreignIdeaJobId}`],
    ["idea events", `/idea-jobs/${foreignIdeaJobId}/events`],
    ["debate detail", `/debate-jobs/${foreignDebateJobId}`],
    ["debate events", `/debate-jobs/${foreignDebateJobId}/events`],
  ])("hides a foreign %s", async (_label, path) => {
    const response = await createApp().request(path)
    expect(response.status).toBe(404)
  })

  it.each([
    ["anonymous viewer", null],
    ["authenticated non-owner", ownerId],
  ] as const)(
    "lets an %s read a public debate and its complete aggregate",
    async (_label, viewerUserId) => {
      db.update(debateJobsTable)
        .set({ isPublic: true })
        .where(eq(debateJobsTable.debateJobId, foreignDebateJobId))
        .run()
      const app = createApp(viewerUserId)

      for (const path of [
        `/debate-jobs/${foreignDebateJobId}`,
        `/debate-jobs/${foreignDebateJobId}/events`,
        `/idea-jobs/${foreignIdeaJobId}`,
        `/idea-jobs/${foreignIdeaJobId}/events`,
        `/deep-search-jobs/${foreignDeepSearchJobId}`,
        `/deep-search-jobs/${foreignDeepSearchJobId}/events`,
        `/streams/${foreignDebateStreamId}`,
        `/streams/${foreignIdeaStreamId}`,
        `/streams/${foreignSearchStreamId}`,
      ]) {
        expect((await app.request(path)).status).toBe(200)
      }

      const debateResponse = await app.request(
        `/debate-jobs/${foreignDebateJobId}`,
      )
      expect(await debateResponse.json()).toMatchObject({
        debateJob: { isOwner: false, isPublic: true },
      })
      const ideaResponse = await app.request(`/idea-jobs/${foreignIdeaJobId}`)
      expect(JSON.stringify(await ideaResponse.json())).not.toContain("userId")
      const searchResponse = await app.request(
        `/deep-search-jobs/${foreignDeepSearchJobId}`,
      )
      expect(JSON.stringify(await searchResponse.json())).not.toContain("userId")
      expect((await app.request(`/streams/${foreignStreamId}`)).status).toBe(404)
    },
  )

  it("applies read scopes to collections without exposing owner IDs", async () => {
    db.update(debateJobsTable)
      .set({ isPublic: true })
      .where(eq(debateJobsTable.debateJobId, foreignDebateJobId))
      .run()
    const app = createApp(ownerId)

    const debateHistory = await app.request("/debate-jobs")
    const ideaHistory = await app.request("/idea-jobs")
    const searchHistory = await app.request("/deep-search-jobs")

    expect(await debateHistory.json()).toMatchObject({
      debateJobs: [{ debateJobId: foreignDebateJobId }],
    })
    const ideas: unknown = await ideaHistory.json()
    expect(ideas).toMatchObject({
      ideaJobs: [{ ideaJobId: foreignIdeaJobId }],
    })
    expect(JSON.stringify(ideas)).not.toContain("userId")
    expect(await searchHistory.json()).toEqual({ deepSearchJobs: [] })
  })

  it("revokes anonymous aggregate access when a debate becomes private", async () => {
    db.update(debateJobsTable)
      .set({ isPublic: true })
      .where(eq(debateJobsTable.debateJobId, foreignDebateJobId))
      .run()
    const app = createApp(null)
    expect(
      (await app.request(`/debate-jobs/${foreignDebateJobId}`)).status,
    ).toBe(200)

    db.update(debateJobsTable)
      .set({ isPublic: false })
      .where(eq(debateJobsTable.debateJobId, foreignDebateJobId))
      .run()

    for (const path of [
      `/debate-jobs/${foreignDebateJobId}`,
      `/idea-jobs/${foreignIdeaJobId}`,
      `/deep-search-jobs/${foreignDeepSearchJobId}`,
      `/streams/${foreignDebateStreamId}`,
    ]) {
      expect((await app.request(path)).status).toBe(404)
    }
  })

  it("prevents a non-owner from updating a public debate", async () => {
    db.update(debateJobsTable)
      .set({ isPublic: true })
      .where(eq(debateJobsTable.debateJobId, foreignDebateJobId))
      .run()

    const response = await createApp().request(
      `/debate-jobs/${foreignDebateJobId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: false }),
      },
    )

    expect(response.status).toBe(404)
    expect(
      db
        .select({ isPublic: debateJobsTable.isPublic })
        .from(debateJobsTable)
        .where(eq(debateJobsTable.debateJobId, foreignDebateJobId))
        .get()?.isPublic,
    ).toBe(true)
  })

  it.each([
    ["deep-search", "/deep-search-jobs", "deepSearchJobs"],
    ["idea", "/idea-jobs", "ideaJobs"],
    ["debate", "/debate-jobs", "debateJobs"],
  ])("omits foreign %s jobs from history", async (_label, path, key) => {
    const response = await createApp().request(path)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ [key]: [] })
  })

  it("passes the authenticated owner to every job manager", async () => {
    const app = createApp()
    const requests = [
      await app.request("/deep-search-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researchRequest: "Research this" }),
      }),
      await app.request("/idea-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Generate ideas" }),
      }),
      await app.request("/debate-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Debate ideas" }),
      }),
    ]

    expect(requests[0]?.status).toBe(202)
    expect(requests[1]?.status).toBe(202)
    expect(requests[2]?.status).toBe(202)
    expect(deepSearchStart).toHaveBeenCalledWith(
      ownerId,
      expect.objectContaining({ researchRequest: "Research this" }),
    )
    expect(ideaStart).toHaveBeenCalledWith(
      ownerId,
      expect.objectContaining({ prompt: "Generate ideas" }),
    )
    expect(debateStart).toHaveBeenCalledWith(ownerId, {
      prompt: "Debate ideas",
      isPublic: false,
    })
  })
})
