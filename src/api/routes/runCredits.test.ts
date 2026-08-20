import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchWebPages,
  ideaJobs,
  llmGenerations,
} from "../db/schema/index.ts"
import type { AppEnv } from "../types/auth.ts"
import { debateJobReads } from "./debates/index.ts"
import type { DebateJobManager } from "./debates/manager.ts"
import { deepSearchJobReads } from "./deepSearch/index.ts"
import type { DeepSearchJobManager } from "./deepSearch/manager.ts"
import { ideaJobReads } from "./ideas/index.ts"
import type { IdeaJobManager } from "./ideas/manager.ts"
import {
  getDebateCreditsUsed,
  getDeepSearchCreditsUsed,
  getIdeaCreditsUsed,
} from "./runCredits.ts"

const debateJobId = "credits-debate"
const ideaJobId = "credits-ideas"
const firstDeepSearchJobId = "credits-search-one"
const secondDeepSearchJobId = "credits-search-two"

function insertCompletedGeneration(input: {
  id: string
  creditsUsed: number
  debateJobId?: string
  ideaJobId?: string
  deepSearchJobId?: string
}): void {
  db.insert(llmGenerations)
    .values({
      llmGenerationId: input.id,
      userId: "test-user-id",
      debateJobId: input.debateJobId,
      ideaJobId: input.ideaJobId,
      deepSearchJobId: input.deepSearchJobId,
      status: "completed",
      text: `Output for ${input.id}`,
      reasoning: "",
      creditsUsed: input.creditsUsed,
      completedAt: new Date(),
    })
    .run()
}

function insertDeepSearchCosts(
  deepSearchJobId: string,
  credits: {
    llm: [number, number]
    queries: [number, number]
    pages: [number, number]
  },
): [string, string] {
  const generationIds = [
    `${deepSearchJobId}-generation-one`,
    `${deepSearchJobId}-generation-two`,
  ] as const
  generationIds.forEach((id, position) => {
    insertCompletedGeneration({
      id,
      deepSearchJobId,
      creditsUsed: credits.llm[position],
    })
    const roundId = `${deepSearchJobId}-round-${position}`
    db.insert(deepSearchRounds)
      .values({
        deepSearchRoundId: roundId,
        deepSearchJobId,
        position,
        llmGenerationId: id,
      })
      .run()
    db.insert(deepSearchQueries)
      .values({
        deepSearchQueryId: `${deepSearchJobId}-query-${position}`,
        deepSearchRoundId: roundId,
        position: 0,
        query: `Query ${position}`,
        creditsUsed: credits.queries[position],
      })
      .run()
    db.insert(deepSearchWebPages)
      .values({
        deepSearchWebPageId: `${deepSearchJobId}-page-${position}`,
        deepSearchJobId,
        url: `https://example.com/${deepSearchJobId}/${position}`,
        creditsUsed: credits.pages[position],
      })
      .run()
  })
  return [...generationIds]
}

function createReadApp(viewerUserId: string | null): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use("*", async (c, next) => {
    c.set("userId", viewerUserId ?? "anonymous-test-user")
    c.set("viewerUserId", viewerUserId)
    await next()
  })
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
  deepSearchJobReads(app, deepSearchManager)
  ideaJobReads(app, ideaJobManager)
  debateJobReads(app, debateJobManager)
  return app
}

describe("derived run credits", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
    db.delete(ideaJobs).run()
    db.delete(deepSearchJobs).run()
    db.delete(llmGenerations).run()
  })

  it("sums each independent charge leaf exactly and exposes totals only to completed owners", async () => {
    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: "test-user-id",
        randomSeed: 1,
        isPublic: true,
      })
      .run()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        userId: "test-user-id",
        debateJobId,
        title: "Credit test",
        slug: "credit-test",
        prompt: "Count every owned charge once",
        numberOfIdeas: 6,
        deepSearchCount: 2,
      })
      .run()
    db.insert(deepSearchJobs)
      .values([
        {
          deepSearchJobId: firstDeepSearchJobId,
          userId: "test-user-id",
          ideaJobId,
          ideaJobPosition: 0,
          title: "First child",
          slug: "credit-test-first-child",
          researchRequest: "Research the first branch",
          maxSearches: 2,
          maxResultsPerSearch: 2,
        },
        {
          deepSearchJobId: secondDeepSearchJobId,
          userId: "test-user-id",
          ideaJobId,
          ideaJobPosition: 1,
          title: "Second child",
          slug: "credit-test-second-child",
          researchRequest: "Research the second branch",
          maxSearches: 2,
          maxResultsPerSearch: 2,
        },
      ])
      .run()

    insertCompletedGeneration({
      id: "debate-generation-one",
      debateJobId,
      creditsUsed: 2,
    })
    insertCompletedGeneration({
      id: "debate-generation-two",
      debateJobId,
      creditsUsed: 3,
    })
    insertCompletedGeneration({
      id: "idea-generation-one",
      ideaJobId,
      creditsUsed: 5,
    })
    insertCompletedGeneration({
      id: "idea-generation-two",
      ideaJobId,
      creditsUsed: 7,
    })
    insertCompletedGeneration({
      id: "idea-generation-three",
      ideaJobId,
      creditsUsed: 0,
    })
    insertCompletedGeneration({
      id: "standalone-title-generation",
      creditsUsed: 1_000,
    })
    const [firstFinalGenerationId] = insertDeepSearchCosts(
      firstDeepSearchJobId,
      { llm: [11, 13], queries: [17, 19], pages: [23, 29] },
    )
    const [secondFinalGenerationId] = insertDeepSearchCosts(
      secondDeepSearchJobId,
      { llm: [31, 37], queries: [41, 43], pages: [47, 53] },
    )

    expect(getDeepSearchCreditsUsed(firstDeepSearchJobId)).toBe(112)
    expect(getDeepSearchCreditsUsed(secondDeepSearchJobId)).toBe(252)
    expect(getIdeaCreditsUsed(ideaJobId)).toBe(376)
    expect(getDebateCreditsUsed(debateJobId)).toBe(381)

    const runningOwner = createReadApp("test-user-id")
    await expect(
      (await runningOwner.request("/deep-search-jobs/credit-test-first-child")).json(),
    ).resolves.toMatchObject({ deepSearchJob: { creditsUsed: null } })
    await expect(
      (await runningOwner.request("/idea-jobs/credit-test")).json(),
    ).resolves.toMatchObject({ ideaJob: { creditsUsed: null } })
    await expect(
      (await runningOwner.request("/debate-jobs/credit-test")).json(),
    ).resolves.toMatchObject({ debateJob: { creditsUsed: null } })

    const completedAt = new Date()
    db.update(deepSearchJobs)
      .set({
        finalAnswerGenerationId: firstFinalGenerationId,
        status: "completed",
        completedAt,
      })
      .where(eq(deepSearchJobs.deepSearchJobId, firstDeepSearchJobId))
      .run()
    db.update(deepSearchJobs)
      .set({
        finalAnswerGenerationId: secondFinalGenerationId,
        status: "completed",
        completedAt,
      })
      .where(eq(deepSearchJobs.deepSearchJobId, secondDeepSearchJobId))
      .run()
    db.update(ideaJobs)
      .set({
        stage: "ideas",
        status: "completed",
        researchPromptGenerationId: "idea-generation-one",
        researchSummaryGenerationId: "idea-generation-two",
        ideaGenerationId: "idea-generation-three",
        completedAt,
      })
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .run()
    db.update(debateJobs)
      .set({ stage: "final", status: "completed", completedAt })
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()

    const completedOwner = createReadApp("test-user-id")
    await expect(
      (await completedOwner.request("/deep-search-jobs/credit-test-first-child")).json(),
    ).resolves.toMatchObject({ deepSearchJob: { creditsUsed: 112 } })
    await expect(
      (await completedOwner.request("/idea-jobs/credit-test")).json(),
    ).resolves.toMatchObject({ ideaJob: { creditsUsed: 376 } })
    await expect(
      (await completedOwner.request("/debate-jobs/credit-test")).json(),
    ).resolves.toMatchObject({ debateJob: { creditsUsed: 381 } })

    const anonymous = createReadApp(null)
    await expect(
      (await anonymous.request("/deep-search-jobs/credit-test-first-child")).json(),
    ).resolves.toMatchObject({ deepSearchJob: { creditsUsed: null } })
    await expect(
      (await anonymous.request("/idea-jobs/credit-test")).json(),
    ).resolves.toMatchObject({ ideaJob: { creditsUsed: null } })
    await expect(
      (await anonymous.request("/debate-jobs/credit-test")).json(),
    ).resolves.toMatchObject({ debateJob: { creditsUsed: null } })
  })
})
