import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../../db/index.ts"
import { debateJobs, ideaJobs, llmGenerations } from "../../db/schema/index.ts"
import { completeDebateJob, reopenDebateJob } from "./jobLifecycle.ts"

describe("debate job lifecycle", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
  })

  it("lets a persisted Stop win the final-verdict parent completion race", () => {
    const debateJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: "test-user-id",
        randomSeed: 21,
        stage: "final",
        cancelRequestedAt: new Date(),
      })
      .run()

    expect(() => completeDebateJob(debateJobId)).toThrow(
      "Effective research root is stop-requested",
    )
    expect(db.select().from(debateJobs).get()).toMatchObject({
      status: "running",
      completedAt: null,
    })
  })

  it("reopens only the debate root without detaching stale provider attempts", () => {
    const debateJobId = crypto.randomUUID()
    const ideaJobId = crypto.randomUUID()
    const debateGenerationId = crypto.randomUUID()
    const ideaGenerationId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: "test-user-id",
        randomSeed: 22,
        stage: "swiss",
        status: "interrupted",
        error: "Workflow stopped by user",
        cancelRequestedAt: new Date(),
        completedAt: new Date(),
      })
      .run()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        debateJobId,
        userId: "test-user-id",
        prompt: "Resume this debate",
        numberOfIdeas: 6,
        deepSearchCount: 1,
        maxSearches: 2,
        maxResultsPerSearch: 2,
        maxRounds: 1,
      })
      .run()
    db.insert(llmGenerations)
      .values([
        {
          llmGenerationId: debateGenerationId,
          userId: "test-user-id",
          debateJobId,
        },
        {
          llmGenerationId: ideaGenerationId,
          userId: "test-user-id",
          ideaJobId,
        },
      ])
      .run()

    reopenDebateJob(debateJobId)

    expect(db.select().from(debateJobs).get()).toMatchObject({
      stage: "swiss",
      status: "running",
      error: null,
      cancelRequestedAt: null,
      completedAt: null,
    })
    expect(
      db
        .select({ status: llmGenerations.status })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, debateGenerationId))
        .get(),
    ).toEqual({ status: "running" })
    expect(
      db
        .select({ status: llmGenerations.status })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, ideaGenerationId))
        .get(),
    ).toEqual({ status: "running" })
  })

  it("rejects reopening a completed debate", () => {
    const debateJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: "test-user-id",
        randomSeed: 23,
        stage: "final",
        status: "completed",
        completedAt: new Date(),
      })
      .run()

    expect(() => reopenDebateJob(debateJobId)).toThrow(
      "Completed debate jobs cannot be resumed",
    )
  })
})
