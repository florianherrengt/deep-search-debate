import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  llmGenerations,
} from "../../db/schema/index.ts"
import { reconstructDeepSearchJobEvents } from "./replay.ts"

const analysis = {
  facts: [
    {
      title: "Supported finding",
      description: "The supplied evidence supports the finding.",
      sources: ["https://example.com/evidence"],
    },
  ],
  disagreements: [],
  gaps: [],
  assumptions: [],
}

function completeJob(analysisText: string): string {
  const jobId = crypto.randomUUID()
  const answerGenerationId = crypto.randomUUID()
  const analysisGenerationId = crypto.randomUUID()
  db.insert(deepSearchJobs)
    .values({
      deepSearchJobId: jobId,
      userId: "test-user-id",
      slug: `job-${jobId}`,
      researchRequest: "Research this",
      maxSearches: 1,
      maxResultsPerSearch: 1,
      strictQuality: false,
    })
    .run()
  db.insert(llmGenerations)
    .values([
      {
        llmGenerationId: answerGenerationId,
        userId: "test-user-id",
        deepSearchJobId: jobId,
        status: "completed",
        text: "Completed answer",
        reasoning: "",
        completedAt: new Date(),
      },
      {
        llmGenerationId: analysisGenerationId,
        userId: "test-user-id",
        deepSearchJobId: jobId,
        status: "completed",
        text: analysisText,
        reasoning: "",
        completedAt: new Date(),
      },
    ])
    .run()
  db.update(deepSearchJobs)
    .set({
      finalAnswerGenerationId: answerGenerationId,
      researchAnalysisGenerationId: analysisGenerationId,
      status: "completed",
      completedAt: new Date(),
    })
    .run()
  return jobId
}

describe("deep-search replay", () => {
  beforeEach(() => {
    db.delete(deepSearchJobs).run()
    db.delete(llmGenerations).run()
  })

  it("reconstructs the validated research analysis before the terminal event", () => {
    const jobId = completeJob(JSON.stringify(analysis))

    expect(reconstructDeepSearchJobEvents(jobId)).toEqual([
      expect.objectContaining({ type: "final-answer-stream" }),
      { type: "research-analysis", analysis },
      { type: "done" },
    ])
  })

  it("does not expose malformed persisted structured output", () => {
    const jobId = completeJob('{"facts":"invalid"}')

    expect(reconstructDeepSearchJobEvents(jobId)).toEqual([
      expect.objectContaining({ type: "final-answer-stream" }),
      { type: "done" },
    ])
  })
})
