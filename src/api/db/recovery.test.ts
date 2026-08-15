import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import { db } from "./index.ts"
import { recoverInterruptedWork } from "./recovery.ts"
import {
  debateJobs,
  debateMatches,
  debateRounds,
  deepSearchJobs,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchWebPages,
  ideaJobs,
  ideas,
  llmGenerations,
} from "./schema/index.ts"

function createFinalStageJob(finalMatchCompleted: boolean): string {
  const ideaJobId = crypto.randomUUID()
  const debateJobId = crypto.randomUUID()
  const generationIds = Array.from({ length: 5 }, () => crypto.randomUUID())
  const completedAt = new Date()

  db.insert(debateJobs)
    .values({
      debateJobId,
      userId: "test-user-id",
      randomSeed: 42,
      stage: "final",
    })
    .run()
  db.insert(ideaJobs)
    .values({
      userId: "test-user-id",
      ideaJobId,
      debateJobId,
      slug: `ideas-${ideaJobId}`,
      prompt: "Choose a building energy product",
      numberOfIdeas: 2,
      deepSearchCount: 1,
    })
    .run()
  db.insert(llmGenerations)
    .values(
      generationIds.map((llmGenerationId) => ({
        userId: "test-user-id",
        ideaJobId,
        llmGenerationId,
        status: "completed" as const,
        text: "Completed output",
        reasoning: "Completed reasoning",
        completedAt,
      })),
    )
    .run()
  const ideaRows = [0, 1].map((position) => ({
    ideaId: crypto.randomUUID(),
    ideaJobId,
    position,
    title: `Idea ${position + 1}`,
    description: `Description ${position + 1}`,
    evaluationGenerationId: generationIds[position + 3],
  }))
  db.insert(ideas).values(ideaRows).run()
  db.update(ideaJobs)
    .set({
      stage: "ideas",
      researchPromptGenerationId: generationIds[0],
      researchSummaryGenerationId: generationIds[1],
      ideaGenerationId: generationIds[2],
      status: "completed",
      completedAt,
    })
    .where(eq(ideaJobs.ideaJobId, ideaJobId))
    .run()
  const debateRoundId = crypto.randomUUID()
  db.insert(debateRounds)
    .values({
      debateRoundId,
      debateJobId,
      stage: "final",
      stageRoundNumber: 1,
    })
    .run()
  db.insert(debateMatches)
    .values({
      debateMatchId: crypto.randomUUID(),
      debateRoundId,
      position: 0,
      firstIdeaId: ideaRows[0].ideaId,
      secondIdeaId: ideaRows[1].ideaId,
      winnerIdeaId: finalMatchCompleted ? ideaRows[0].ideaId : null,
      completedAt: finalMatchCompleted ? completedAt : null,
    })
    .run()

  return debateJobId
}

describe("restart recovery", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
    db.delete(deepSearchJobs).run()
    db.delete(llmGenerations).run()
  })

  it("interrupts every active layer of an orphaned deep-search job", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    const selectionGenerationId = crypto.randomUUID()
    const pageSummaryGenerationId = crypto.randomUUID()
    const reviewGenerationId = crypto.randomUUID()
    const deepSearchRoundId = crypto.randomUUID()
    const deepSearchQueryId = crypto.randomUUID()
    const deepSearchWebPageId = crypto.randomUUID()

    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId,
        userId: "test-user-id",
        slug: `search-${deepSearchJobId}`,
        researchRequest: "Research restart recovery",
        maxSearches: 1,
        maxResultsPerSearch: 1,
      })
      .run()
    db.insert(llmGenerations)
      .values(
        [
          queryGenerationId,
          selectionGenerationId,
          pageSummaryGenerationId,
          reviewGenerationId,
        ].map((llmGenerationId) => ({
          llmGenerationId,
          userId: "test-user-id",
          deepSearchJobId,
        })),
      )
      .run()
    db.insert(deepSearchRounds)
      .values({
        deepSearchRoundId,
        deepSearchJobId,
        llmGenerationId: queryGenerationId,
        reviewGenerationId,
      })
      .run()
    db.insert(deepSearchQueries)
      .values({
        deepSearchQueryId,
        deepSearchRoundId,
        position: 0,
        query: "restart recovery",
        status: "selecting",
        selectionGenerationId,
      })
      .run()
    db.insert(deepSearchWebPages)
      .values({
        deepSearchWebPageId,
        deepSearchJobId,
        url: "https://example.com/recovery",
        status: "summarizing",
        summaryGenerationId: pageSummaryGenerationId,
      })
      .run()

    recoverInterruptedWork()

    expect(
      db
        .select({ status: deepSearchJobs.status, error: deepSearchJobs.error })
        .from(deepSearchJobs)
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .get(),
    ).toEqual({
      status: "interrupted",
      error: "Interrupted by a server restart",
    })
    expect(
      db
        .select({
          status: deepSearchQueries.status,
          errorStage: deepSearchQueries.errorStage,
          errorMessage: deepSearchQueries.errorMessage,
        })
        .from(deepSearchQueries)
        .where(eq(deepSearchQueries.deepSearchQueryId, deepSearchQueryId))
        .get(),
    ).toEqual({
      status: "failed",
      errorStage: "selection",
      errorMessage: "Interrupted by a server restart",
    })
    expect(
      db
        .select({
          status: deepSearchWebPages.status,
          errorStage: deepSearchWebPages.errorStage,
          errorMessage: deepSearchWebPages.errorMessage,
        })
        .from(deepSearchWebPages)
        .where(eq(deepSearchWebPages.deepSearchWebPageId, deepSearchWebPageId))
        .get(),
    ).toEqual({
      status: "failed",
      errorStage: "summary",
      errorMessage: "Interrupted by a server restart",
    })
    const recoveredRound = db
      .select({
          reviewError: deepSearchRounds.reviewError,
          reviewCompletedAt: deepSearchRounds.reviewCompletedAt,
        })
        .from(deepSearchRounds)
        .where(
          eq(deepSearchRounds.deepSearchRoundId, deepSearchRoundId),
      )
      .get()
    expect(recoveredRound?.reviewError).toBe(
      "Interrupted by a server restart",
    )
    expect(recoveredRound?.reviewCompletedAt).toBeInstanceOf(Date)
    expect(
      db
        .select({ status: llmGenerations.status })
        .from(llmGenerations)
        .where(eq(llmGenerations.deepSearchJobId, deepSearchJobId))
        .all(),
    ).toEqual(
      Array.from({ length: 4 }, () => ({ status: "interrupted" })),
    )
  })

  it("finalizes a job whose final verdict committed before the restart", () => {
    const completedJobId = createFinalStageJob(true)
    const incompleteJobId = createFinalStageJob(false)

    recoverInterruptedWork()

    const completedJob = db.query.debateJobs.findFirst({
      where: eq(debateJobs.debateJobId, completedJobId),
    }).sync()
    const incompleteJob = db.query.debateJobs.findFirst({
      where: eq(debateJobs.debateJobId, incompleteJobId),
    }).sync()

    expect(completedJob).toMatchObject({
      status: "completed",
      stage: "final",
      error: null,
    })
    expect(completedJob?.completedAt).toBeInstanceOf(Date)
    expect(incompleteJob).toMatchObject({
      status: "interrupted",
      error: "Interrupted by a server restart",
    })
    expect(incompleteJob?.completedAt).toBeInstanceOf(Date)
  })

  it("terminalizes a cancel-requested debate tree before ordinary recovery", () => {
    const debateJobId = crypto.randomUUID()
    const ideaJobId = crypto.randomUUID()
    const deepSearchJobId = crypto.randomUUID()
    const generationId = crypto.randomUUID()

    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: "test-user-id",
        randomSeed: 42,
        cancelRequestedAt: new Date(),
      })
      .run()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        debateJobId,
        userId: "test-user-id",
        slug: `idea-${ideaJobId}`,
        prompt: "Generate ideas for cancellation recovery",
        numberOfIdeas: 6,
        deepSearchCount: 1,
      })
      .run()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId,
        ideaJobId,
        ideaJobPosition: 0,
        userId: "test-user-id",
        slug: `search-${deepSearchJobId}`,
        researchRequest: "Research cancellation recovery",
        maxSearches: 1,
        maxResultsPerSearch: 1,
      })
      .run()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: generationId,
        userId: "test-user-id",
        deepSearchJobId,
      })
      .run()

    recoverInterruptedWork()

    const recoveredDebate = db.select({
        status: debateJobs.status,
        error: debateJobs.error,
        cancelRequestedAt: debateJobs.cancelRequestedAt,
      })
        .from(debateJobs)
        .where(eq(debateJobs.debateJobId, debateJobId))
        .get()
    expect(recoveredDebate).toMatchObject({
      status: "interrupted",
      error: "Stopped by user",
    })
    expect(recoveredDebate?.cancelRequestedAt).toBeInstanceOf(Date)
    expect(
      db.select({ status: ideaJobs.status, error: ideaJobs.error })
        .from(ideaJobs)
        .where(eq(ideaJobs.ideaJobId, ideaJobId))
        .get(),
    ).toEqual({
      status: "interrupted",
      error: "Interrupted because the parent workflow was stopped",
    })
    expect(
      db.select({ status: deepSearchJobs.status, error: deepSearchJobs.error })
        .from(deepSearchJobs)
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .get(),
    ).toEqual({
      status: "interrupted",
      error: "Interrupted because the parent workflow was stopped",
    })
    expect(
      db.select({ status: llmGenerations.status })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, generationId))
        .get(),
    ).toEqual({ status: "interrupted" })
  })

  it("does not repair a cancel-requested final-verdict debate as completed", () => {
    const debateJobId = createFinalStageJob(true)
    db.update(debateJobs)
      .set({ cancelRequestedAt: new Date() })
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()

    recoverInterruptedWork()

    expect(
      db.select({ status: debateJobs.status, error: debateJobs.error })
        .from(debateJobs)
        .where(eq(debateJobs.debateJobId, debateJobId))
        .get(),
    ).toEqual({ status: "interrupted", error: "Stopped by user" })
  })
})
