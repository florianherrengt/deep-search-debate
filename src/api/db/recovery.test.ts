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
    critiqueGenerationId: generationIds[position + 3],
  }))
  db.insert(ideas).values(ideaRows).run()
  db.update(ideaJobs)
    .set({
      stage: "critique",
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
