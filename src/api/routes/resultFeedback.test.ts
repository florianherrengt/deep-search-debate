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

const ownerId = "test-user-id"
const otherUserId = "feedback-other-user-id"
const debateJobId = "10000000-0000-4000-8000-000000000001"
const ideaJobId = "20000000-0000-4000-8000-000000000002"
const deepSearchJobId = "30000000-0000-4000-8000-000000000003"
const ideaSlug = "feedback-ideas"
const deepSearchSlug = "feedback-search"

const deepSearchManager: DeepSearchJobManager = {
  start: vi.fn(),
  stop: vi.fn(),
  requireParentQualityAcceptance: vi.fn(),
  getLiveJob: vi.fn(),
}
const ideaJobManager: IdeaJobManager = {
  start: vi.fn(),
  stop: vi.fn(),
  getLiveJob: vi.fn(),
}
const debateJobManager: DebateJobManager = {
  start: vi.fn(),
  stop: vi.fn(),
  getLiveJob: vi.fn(),
}

function createApp(viewerUserId: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use("*", async (c, next) => {
    c.set("userId", viewerUserId)
    c.set("viewerUserId", viewerUserId)
    await next()
  })
  deepSearchJobReads(app, deepSearchManager)
  ideaJobReads(app, ideaJobManager)
  debateJobReads(app, debateJobManager)
  deepSearchJobs(app, deepSearchManager)
  ideaJobs(app, ideaJobManager)
  debateJobs(app, debateJobManager)
  return app
}

function patchFeedback(
  app: Hono<AppEnv>,
  path: string,
  body: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

function insertCompletedAggregate(): void {
  const completedAt = new Date("2026-08-20T12:00:00.000Z")
  db.insert(debateJobsTable)
    .values({
      debateJobId,
      userId: ownerId,
      randomSeed: 1,
      isPublic: true,
    })
    .run()
  db.insert(ideaJobsTable)
    .values({
      ideaJobId,
      debateJobId,
      userId: ownerId,
      title: "Feedback ideas",
      slug: ideaSlug,
      prompt: "Generate feedback test ideas",
      numberOfIdeas: 6,
      deepSearchCount: 1,
    })
    .run()
  db.insert(deepSearchJobsTable)
    .values({
      deepSearchJobId,
      ideaJobId,
      ideaJobPosition: 0,
      userId: ownerId,
      title: "Feedback search",
      slug: deepSearchSlug,
      researchRequest: "Research feedback behavior",
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
    })
    .run()

  const researchPromptGenerationId = crypto.randomUUID()
  const researchSummaryGenerationId = crypto.randomUUID()
  const ideaGenerationId = crypto.randomUUID()
  const finalAnswerGenerationId = crypto.randomUUID()
  db.insert(llmGenerations)
    .values([
      ...[
        researchPromptGenerationId,
        researchSummaryGenerationId,
        ideaGenerationId,
      ].map((llmGenerationId) => ({
        llmGenerationId,
        userId: ownerId,
        ideaJobId,
        status: "completed" as const,
        text: "Generated idea output",
        reasoning: "",
        completedAt,
      })),
      {
        llmGenerationId: finalAnswerGenerationId,
        userId: ownerId,
        deepSearchJobId,
        status: "completed" as const,
        text: "Research answer",
        reasoning: "",
        completedAt,
      },
    ])
    .run()
  db.update(deepSearchJobsTable)
    .set({
      finalAnswerGenerationId,
      status: "completed",
      completedAt,
    })
    .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
    .run()
  db.update(ideaJobsTable)
    .set({
      researchPromptGenerationId,
      researchSummaryGenerationId,
      ideaGenerationId,
      stage: "ideas",
      status: "completed",
      completedAt,
    })
    .where(eq(ideaJobsTable.ideaJobId, ideaJobId))
    .run()
  db.update(debateJobsTable)
    .set({ stage: "final", status: "completed", completedAt })
    .where(eq(debateJobsTable.debateJobId, debateJobId))
    .run()
}

const feedbackPaths = [
  `/deep-search-jobs/${deepSearchJobId}/feedback`,
  `/idea-jobs/${ideaJobId}/feedback`,
  `/debate-jobs/${debateJobId}/feedback`,
]

describe("result feedback routes", () => {
  beforeEach(() => {
    db.delete(debateJobsTable).run()
    db.delete(user).where(eq(user.id, otherUserId)).run()
    db.insert(user)
      .values({
        id: otherUserId,
        name: "Feedback Other User",
        email: "feedback-other@example.com",
        emailVerified: true,
      })
      .run()
    insertCompletedAggregate()
  })

  it.each(feedbackPaths)(
    "allows repeated rating changes and replaces negative text at %s",
    async (path) => {
      const app = createApp(ownerId)

      for (const expected of [
        { body: { type: "rating", rating: false }, written: false },
        { body: { type: "rating", rating: false }, written: false },
        { body: { type: "text", text: "First explanation" }, written: true },
        { body: { type: "text", text: "Replacement explanation" }, written: true },
        { body: { type: "rating", rating: false }, written: true },
      ] as const) {
        const response = await patchFeedback(app, path, expected.body)
        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({
          feedback: {
            rating: false,
            hasWrittenFeedback: expected.written,
          },
        })
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await patchFeedback(app, path, {
          type: "rating",
          rating: true,
        })
        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({
          feedback: { rating: true, hasWrittenFeedback: false },
        })
      }

      const changedBack = await patchFeedback(app, path, {
        type: "rating",
        rating: false,
      })
      await expect(changedBack.json()).resolves.toEqual({
        feedback: { rating: false, hasWrittenFeedback: false },
      })
    },
  )

  it.each(feedbackPaths)(
    "hides owner feedback mutations from public non-owners at %s",
    async (path) => {
      const response = await patchFeedback(createApp(otherUserId), path, {
        type: "rating",
        rating: true,
      })

      expect(response.status).toBe(404)
    },
  )

  it.each([
    "/deep-search-jobs/40000000-0000-4000-8000-000000000004/feedback",
    "/idea-jobs/50000000-0000-4000-8000-000000000005/feedback",
    "/debate-jobs/60000000-0000-4000-8000-000000000006/feedback",
  ])("returns 404 for an unknown result at %s", async (path) => {
    const response = await patchFeedback(createApp(ownerId), path, {
      type: "rating",
      rating: true,
    })

    expect(response.status).toBe(404)
  })

  it("requires completed mutations but projects feedback authority for running owners", async () => {
    const app = createApp(ownerId)
    const runningDebateJobId = crypto.randomUUID()
    const runningIdeaJobId = crypto.randomUUID()
    const runningDeepSearchJobId = crypto.randomUUID()
    const runningIdeaSlug = `running-${runningIdeaJobId}`
    const runningDeepSearchSlug = `running-${runningDeepSearchJobId}`
    db.insert(debateJobsTable)
      .values({
        debateJobId: runningDebateJobId,
        userId: ownerId,
        randomSeed: 2,
      })
      .run()
    db.insert(ideaJobsTable)
      .values({
        ideaJobId: runningIdeaJobId,
        debateJobId: runningDebateJobId,
        userId: ownerId,
        slug: runningIdeaSlug,
        prompt: "Generate running ideas",
        numberOfIdeas: 6,
        deepSearchCount: 1,
      })
      .run()
    db.insert(deepSearchJobsTable)
      .values({
        deepSearchJobId: runningDeepSearchJobId,
        ideaJobId: runningIdeaJobId,
        ideaJobPosition: 0,
        userId: ownerId,
        slug: runningDeepSearchSlug,
        researchRequest: "Research a running result",
        maxSearches: 1,
        maxResultsPerSearch: 1,
        maxRounds: 1,
      })
      .run()

    for (const path of [
      `/deep-search-jobs/${runningDeepSearchJobId}/feedback`,
      `/idea-jobs/${runningIdeaJobId}/feedback`,
      `/debate-jobs/${runningDebateJobId}/feedback`,
    ]) {
      const response = await patchFeedback(app, path, {
        type: "rating",
        rating: false,
      })
      expect(response.status).toBe(409)
    }

    for (const [path, responseKey] of [
      [`/deep-search-jobs/${runningDeepSearchSlug}`, "deepSearchJob"],
      [`/idea-jobs/${runningIdeaSlug}`, "ideaJob"],
      [`/debate-jobs/${runningIdeaSlug}`, "debateJob"],
    ] as const) {
      const body: unknown = await (await app.request(path)).json()
      expect(body).toMatchObject({
        [responseKey]: {
          feedback: { rating: null, hasWrittenFeedback: false },
        },
      })
    }
  })

  it("requires a negative rating and bounded non-empty written feedback", async () => {
    const app = createApp(ownerId)
    const path = `/debate-jobs/${debateJobId}/feedback`

    expect(
      (await patchFeedback(app, path, { type: "text", text: "Explain" }))
        .status,
    ).toBe(409)
    expect(
      (await patchFeedback(app, path, { type: "text", text: "   " }))
        .status,
    ).toBe(400)
    expect(
      (await patchFeedback(app, path, { type: "text", text: "x".repeat(5_001) }))
        .status,
    ).toBe(400)

    await patchFeedback(app, path, { type: "rating", rating: false })
    const rawText = "  A specific explanation  "
    expect(
      (await patchFeedback(app, path, { type: "text", text: rawText })).status,
    ).toBe(200)
    expect(
      db
        .select({ feedbackText: debateJobsTable.feedbackText })
        .from(debateJobsTable)
        .where(eq(debateJobsTable.debateJobId, debateJobId))
        .get()?.feedbackText,
    ).toBe(rawText)

    await patchFeedback(app, path, { type: "rating", rating: true })
    expect(
      db
        .select({ feedbackText: debateJobsTable.feedbackText })
        .from(debateJobsTable)
        .where(eq(debateJobsTable.debateJobId, debateJobId))
        .get()?.feedbackText,
    ).toBeNull()
  })

  it("reloads derived feedback only for the owner and never exposes raw text", async () => {
    const ownerApp = createApp(ownerId)
    for (const path of feedbackPaths) {
      await patchFeedback(ownerApp, path, { type: "rating", rating: false })
      await patchFeedback(ownerApp, path, {
        type: "text",
        text: "Private written feedback",
      })
    }

    for (const path of [
      `/deep-search-jobs/${deepSearchSlug}`,
      `/idea-jobs/${ideaSlug}`,
      `/debate-jobs/${ideaSlug}`,
    ]) {
      const ownerBody: unknown = await (await ownerApp.request(path)).json()
      expect(ownerBody).toMatchObject({
        [path.startsWith("/deep-search")
          ? "deepSearchJob"
          : path.startsWith("/idea")
            ? "ideaJob"
            : "debateJob"]: {
          feedback: { rating: false, hasWrittenFeedback: true },
        },
      })
      expect(JSON.stringify(ownerBody)).not.toContain("Private written feedback")
      expect(JSON.stringify(ownerBody)).not.toContain("feedbackText")

      const publicBody: unknown = await (
        await createApp(otherUserId).request(path)
      ).json()
      expect(publicBody).toMatchObject({
        [path.startsWith("/deep-search")
          ? "deepSearchJob"
          : path.startsWith("/idea")
            ? "ideaJob"
            : "debateJob"]: { feedback: null },
      })
    }
  })
})
