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
import { debateJobs } from "./debates/index.ts"
import type { DebateJobManager } from "./debates/manager.ts"
import { deepSearchJobs } from "./deepSearch/index.ts"
import type { DeepSearchJobManager } from "./deepSearch/manager.ts"
import { ideaJobs } from "./ideas/index.ts"
import type { IdeaJobManager } from "./ideas/manager.ts"
import { streams } from "./streams.ts"

const ownerId = "test-user-id"
const foreignUserId = "foreign-test-user-id"
const foreignIdeaJobId = "11111111-1111-4111-8111-111111111111"
const foreignDeepSearchJobId = "22222222-2222-4222-8222-222222222222"
const foreignDebateJobId = "33333333-3333-4333-8333-333333333333"
const foreignStreamId = "44444444-4444-4444-8444-444444444444"

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

function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use("*", async (c, next) => {
    c.set("userId", ownerId)
    await next()
  })
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
      researchRequest: "Foreign research",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })
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
    })
  })
})
