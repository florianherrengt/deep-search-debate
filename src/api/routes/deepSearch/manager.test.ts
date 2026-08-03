import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ runDeepSearchJob: vi.fn() }))

vi.mock("./run.ts", () => ({ runDeepSearchJob: mocks.runDeepSearchJob }))

import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  deepSearchWebPages,
  ideaJobs,
  llmGenerations,
} from "../../db/schema/index.ts"
import { createDeepSearchJobManager } from "./manager.ts"
import type { LiveDeepSearchJob } from "./schemas.ts"

function completeWithFailedPage(
  deepSearchJobId: string,
  errorStage: "extraction" | "summary",
): void {
  db.insert(llmGenerations)
    .values({
      llmGenerationId: "final-answer-id",
      status: "completed",
      text: "Completed answer",
      reasoning: "Completed reasoning",
      completedAt: new Date(),
    })
    .run()
  db.insert(deepSearchWebPages)
    .values({
      deepSearchWebPageId: "page-id",
      deepSearchJobId,
      url: "https://example.com/failed",
      status: "failed",
      errorStage,
      errorMessage:
        errorStage === "extraction" ? "Extraction failed" : "Summary failed",
      completedAt: new Date(),
    })
    .run()
  db.update(deepSearchJobs)
    .set({
      finalAnswerGenerationId: "final-answer-id",
      status: "completed",
      completedAt: new Date(),
    })
    .run()
}

describe("createDeepSearchJobManager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.delete(ideaJobs).run()
    db.delete(deepSearchJobs).run()
    db.delete(llmGenerations).run()
  })

  it("accepts completed research when a selected page cannot be extracted", async () => {
    mocks.runDeepSearchJob.mockImplementation((deepSearchJobId: string) => {
      completeWithFailedPage(deepSearchJobId, "extraction")
      return Promise.resolve()
    })
    const manager = createDeepSearchJobManager()
    const started = manager.start({
      researchRequest: "Research this",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    await expect(started.completion).resolves.toBe("Completed answer")
    expect(manager.getLiveJob(started.deepSearchJobId)).toBeUndefined()
  })

  it("rejects a failed page-summary generation", async () => {
    mocks.runDeepSearchJob.mockImplementation((deepSearchJobId: string) => {
      completeWithFailedPage(deepSearchJobId, "summary")
      return Promise.resolve()
    })
    const manager = createDeepSearchJobManager()
    const started = manager.start({
      researchRequest: "Research this",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    await expect(started.completion).rejects.toThrow("Summary failed")
    expect(manager.getLiveJob(started.deepSearchJobId)).toBeUndefined()
  })

  it("retains its terminal live log when durable terminal persistence failed", async () => {
    mocks.runDeepSearchJob.mockImplementation(
      (_deepSearchJobId: string, job: LiveDeepSearchJob) => {
        job.publish({ type: "error", message: "SQLite unavailable" })
        job.publish({ type: "done" })
        job.close()
        return Promise.resolve()
      },
    )
    const manager = createDeepSearchJobManager()
    const started = manager.start({
      researchRequest: "Research this",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    await expect(started.completion).rejects.toThrow("Deep search failed")
    expect(manager.getLiveJob(started.deepSearchJobId)).toBeDefined()
  })
})
