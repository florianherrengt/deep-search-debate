import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import { db } from "./index.ts"
import { recoverInterruptedWork } from "./recovery.ts"
import {
  debateJobs,
  debateMatches,
  debateRounds,
  ideaJobs,
  ideas,
  llmGenerations,
} from "./schema/index.ts"

function createFinalStageJob(finalMatchCompleted: boolean): string {
  const ideaJobId = crypto.randomUUID()
  const debateJobId = crypto.randomUUID()
  const generationIds = Array.from({ length: 3 }, () => crypto.randomUUID())
  const completedAt = new Date()

  db.insert(llmGenerations)
    .values(
      generationIds.map((llmGenerationId) => ({
        llmGenerationId,
        status: "completed" as const,
        text: "Completed output",
        reasoning: "Completed reasoning",
        completedAt,
      })),
    )
    .run()
  db.insert(ideaJobs)
    .values({
      ideaJobId,
      prompt: "Choose a building energy product",
      stage: "ideas",
      numberOfIdeas: 2,
      deepSearchCount: 1,
      researchPromptGenerationId: generationIds[0],
      researchSummaryGenerationId: generationIds[1],
      ideaGenerationId: generationIds[2],
      status: "completed",
      completedAt,
    })
    .run()

  const ideaRows = [0, 1].map((position) => ({
    ideaId: crypto.randomUUID(),
    ideaJobId,
    position,
    title: `Idea ${position + 1}`,
    description: `Description ${position + 1}`,
  }))
  db.insert(ideas).values(ideaRows).run()
  db.insert(debateJobs)
    .values({ debateJobId, ideaJobId, randomSeed: 42, stage: "final" })
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
    db.delete(ideaJobs).run()
    db.delete(llmGenerations).run()
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
})
