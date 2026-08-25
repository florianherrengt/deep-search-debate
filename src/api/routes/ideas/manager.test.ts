import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ runIdeaJob: vi.fn() }))

vi.mock("./run.ts", () => ({ runIdeaJob: mocks.runIdeaJob }))

import { db } from "../../db/index.ts"
import { ideaJobs, llmGenerations } from "../../db/schema/index.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { interruptIdeaJob } from "./jobLifecycle.ts"
import { createIdeaJobManager } from "./manager.ts"
import type { LiveIdeaJob } from "./schemas.ts"

const deepSearchManager: DeepSearchJobManager = {
  start: vi.fn(),
  resumeExisting: vi.fn(),
  stop: vi.fn(),
  getLiveJob: vi.fn(),
}

describe("idea job manager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.delete(ideaJobs).run()
  })

  it("reopens, seeds, and deduplicates a persisted interrupted idea job", async () => {
    mocks.runIdeaJob.mockReturnValue(new Promise<void>(() => undefined))
    const ideaJobId = crypto.randomUUID()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        userId: "test-user-id",
        title: "Interrupted ideas",
        slug: "interrupted-ideas",
        prompt: "Resume these ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
        maxSearches: 3,
        maxResultsPerSearch: 3,
        maxRounds: 3,
      })
      .run()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: "completed-planning",
        userId: "test-user-id",
        ideaJobId,
        status: "completed",
        text: "[]",
        reasoning: "Planned",
        completedAt: new Date(),
      })
      .run()
    db.update(ideaJobs)
      .set({
        researchPromptGenerationId: "completed-planning",
        status: "interrupted",
        error: "Server stopped",
        completedAt: new Date(),
      })
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .run()
    const manager = createIdeaJobManager(deepSearchManager)

    const first = manager.resumeExisting(ideaJobId, {
      userId: "test-user-id",
    })
    const duplicate = manager.resumeExisting(ideaJobId, {
      userId: "test-user-id",
    })

    expect(duplicate.completion).toBe(first.completion)
    expect(mocks.runIdeaJob).toHaveBeenCalledOnce()
    const liveJob = (
      mocks.runIdeaJob.mock.calls[0]?.[0] as { job: LiveIdeaJob } | undefined
    )?.job
    if (!liveJob) throw new Error("Expected a resumed live idea job")
    const events = liveJob.subscribe()
    await expect(events.next()).resolves.toEqual({
      done: false,
      value: {
        type: "research-prompt-stream",
        streamId: "completed-planning",
      },
    })
    await events.return(undefined)
    expect(
      db
        .select({ status: ideaJobs.status })
        .from(ideaJobs)
        .where(eq(ideaJobs.ideaJobId, ideaJobId))
        .get(),
    ).toEqual({ status: "running" })
  })

  it("reuses a completed child internally but rejects a root Resume request", async () => {
    const ideaJobId = crypto.randomUUID()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        userId: "test-user-id",
        title: "Completed ideas",
        slug: "completed-ideas",
        prompt: "Completed child",
        numberOfIdeas: 8,
        deepSearchCount: 2,
        maxSearches: 3,
        maxResultsPerSearch: 3,
        maxRounds: 3,
      })
      .run()
    const generationIds = ["planning", "summary", "ideas"] as const
    db.insert(llmGenerations)
      .values(
        generationIds.map((llmGenerationId) => ({
          llmGenerationId,
          userId: "test-user-id",
          ideaJobId,
          status: "completed" as const,
          text: "Completed",
          reasoning: "Completed",
          completedAt: new Date(),
        })),
      )
      .run()
    db.update(ideaJobs)
      .set({
        researchPromptGenerationId: generationIds[0],
        researchSummaryGenerationId: generationIds[1],
        ideaGenerationId: generationIds[2],
        stage: "ideas",
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .run()
    const manager = createIdeaJobManager(deepSearchManager)

    await expect(manager.resumeExisting(ideaJobId).completion).resolves.toBeUndefined()
    expect(() =>
      manager.resumeExisting(ideaJobId, { userId: "test-user-id" }),
    ).toThrow("Completed idea jobs cannot be resumed")
    expect(mocks.runIdeaJob).not.toHaveBeenCalled()
  })

  it("waits for a stopped live execution before resuming it once", async () => {
    const stoppedRun = Promise.withResolvers<void>()
    const resumedRun = Promise.withResolvers<void>()
    mocks.runIdeaJob
      .mockReturnValueOnce(stoppedRun.promise)
      .mockReturnValueOnce(resumedRun.promise)
    const ideaJobId = crypto.randomUUID()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        userId: "test-user-id",
        title: "Resume ideas after Stop",
        slug: "resume-ideas-after-stop",
        prompt: "Resume these ideas immediately after Stop",
        numberOfIdeas: 8,
        deepSearchCount: 2,
        maxSearches: 3,
        maxResultsPerSearch: 3,
        maxRounds: 3,
        status: "interrupted",
        error: "Server stopped",
        completedAt: new Date(),
      })
      .run()
    const manager = createIdeaJobManager(deepSearchManager)
    const started = manager.resumeExisting(ideaJobId, {
      userId: "test-user-id",
    })

    expect(manager.stop("test-user-id", ideaJobId)).toMatchObject({
      kind: "requested",
      newlyRequested: true,
    })
    const resumed = manager.resumeExisting(ideaJobId, {
      userId: "test-user-id",
    })
    const duplicate = manager.resumeExisting(ideaJobId, {
      userId: "test-user-id",
    })
    expect(mocks.runIdeaJob).toHaveBeenCalledOnce()

    interruptIdeaJob(ideaJobId, "Workflow stopped by user")
    stoppedRun.reject(new Error("Workflow stopped by user"))
    await expect(started.completion).rejects.toThrow("Workflow stopped by user")
    await vi.waitFor(() => {
      expect(mocks.runIdeaJob).toHaveBeenCalledTimes(2)
    })

    resumedRun.reject(new Error("Resumed execution failed"))
    await expect(resumed.completion).rejects.toThrow("Resumed execution failed")
    await expect(duplicate.completion).rejects.toThrow(
      "Resumed execution failed",
    )
    expect(mocks.runIdeaJob).toHaveBeenCalledTimes(2)
  })
})
