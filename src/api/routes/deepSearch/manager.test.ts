import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generatePromptTitle: vi.fn().mockResolvedValue("Research This"),
  runDeepSearchJob: vi.fn(),
}))

vi.mock("./run.ts", () => ({ runDeepSearchJob: mocks.runDeepSearchJob }))
vi.mock("../../llms/generateText.ts", () => ({
  generatePromptTitle: mocks.generatePromptTitle,
}))

import { db } from "../../db/index.ts"
import { config } from "../../config.ts"
import {
  deepSearchJobs,
  deepSearchRounds,
  deepSearchWebPages,
  ideaJobs,
  llmGenerations,
  user,
} from "../../db/schema/index.ts"
import { createDeepSearchJobManager } from "./manager.ts"
import { interruptDeepSearchJob } from "./jobLifecycle.ts"
import { reconstructDeepSearchJobEvents } from "./replay.ts"
import type { LiveDeepSearchJob } from "./schemas.ts"
import {
  WorkflowInterruptedError,
  workflowAbortReason,
} from "../../workflowRuntime.ts"

async function readEvents(job: LiveDeepSearchJob) {
  const events = []
  for await (const event of job.subscribe()) events.push(event)
  return events
}

function completeWithExtractionFailure(deepSearchJobId: string): void {
  db.insert(llmGenerations)
    .values({
      userId: "test-user-id",
      deepSearchJobId,
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
      errorStage: "extraction",
      errorMessage: "Extraction failed",
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
    db.delete(user).where(eq(user.id, "other-test-user-id")).run()
  })

  it("rejects an excessive internal workload before creating a job", async () => {
    const manager = createDeepSearchJobManager()

    await expect(
      manager.start("test-user-id", {
        researchRequest: "Research this",
        maxSearches: 10,
        maxResultsPerSearch: 4,
      }),
    ).rejects.toThrow("30 selected URLs")
    expect(mocks.generatePromptTitle).not.toHaveBeenCalled()
    expect(mocks.runDeepSearchJob).not.toHaveBeenCalled()
    expect(db.select().from(deepSearchJobs).all()).toEqual([])
  })

  it("reopens, seeds, and deduplicates a persisted interrupted job", async () => {
    const completion = Promise.withResolvers<string>()
    mocks.runDeepSearchJob.mockReturnValue(completion.promise)
    const deepSearchJobId = crypto.randomUUID()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId,
        userId: "test-user-id",
        title: "Interrupted research",
        slug: "interrupted-research",
        researchRequest: "Resume this research",
        maxSearches: 3,
        maxResultsPerSearch: 3,
        maxRounds: 3,
        strictQuality: false,
      })
      .run()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: "completed-planning",
        userId: "test-user-id",
        deepSearchJobId,
        status: "completed",
        text: "[]",
        reasoning: "Planned",
        completedAt: new Date(),
      })
      .run()
    db.insert(deepSearchRounds)
      .values({
        deepSearchRoundId: crypto.randomUUID(),
        deepSearchJobId,
        position: 0,
        llmGenerationId: "completed-planning",
      })
      .run()
    db.update(deepSearchJobs)
      .set({
        status: "interrupted",
        error: "Server stopped",
        completedAt: new Date(),
      })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()
    const manager = createDeepSearchJobManager()

    const first = manager.resumeExisting(deepSearchJobId, {
      userId: "test-user-id",
    })
    const duplicate = manager.resumeExisting(deepSearchJobId, {
      userId: "test-user-id",
    })

    expect(duplicate.completion).toBe(first.completion)
    expect(mocks.runDeepSearchJob).toHaveBeenCalledOnce()
    const liveJob = mocks.runDeepSearchJob.mock.calls[0]?.[2] as LiveDeepSearchJob
    const events = liveJob.subscribe()
    await expect(events.next()).resolves.toEqual({
      done: false,
      value: { type: "query-stream", round: 0, streamId: "completed-planning" },
    })
    await events.return(undefined)
    expect(
      db
        .select({ status: deepSearchJobs.status })
        .from(deepSearchJobs)
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .get(),
    ).toEqual({ status: "running" })
    completion.resolve("Resumed answer")
    await expect(first.completion).resolves.toBe("Resumed answer")
  })

  it("does not reopen a completed persisted job", () => {
    const deepSearchJobId = crypto.randomUUID()
    const generationId = crypto.randomUUID()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId,
        userId: "test-user-id",
        title: "Completed research",
        slug: "completed-research",
        researchRequest: "Already completed",
        maxSearches: 3,
        maxResultsPerSearch: 3,
        maxRounds: 3,
        strictQuality: false,
      })
      .run()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: generationId,
        userId: "test-user-id",
        deepSearchJobId,
        status: "completed",
        text: "Final answer",
        reasoning: "Reasoning",
        completedAt: new Date(),
      })
      .run()
    db.update(deepSearchJobs)
      .set({
        finalAnswerGenerationId: generationId,
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()

    expect(() =>
      createDeepSearchJobManager().resumeExisting(deepSearchJobId, {
        userId: "test-user-id",
      }),
    ).toThrow("Completed deep-search job cannot be reopened")
    expect(mocks.runDeepSearchJob).not.toHaveBeenCalled()
  })

  it("does not create an idea child after its effective root requested Stop", async () => {
    const parentIdeaJobId = crypto.randomUUID()
    db.insert(ideaJobs)
      .values({
        ideaJobId: parentIdeaJobId,
        userId: "test-user-id",
        prompt: "Generate ideas",
        numberOfIdeas: 8,
        deepSearchCount: 2,
        maxSearches: 3,
        maxResultsPerSearch: 3,
        maxRounds: 3,
        cancelRequestedAt: new Date(),
      })
      .run()

    await expect(
      createDeepSearchJobManager().start("test-user-id", {
        title: "Late child",
        researchRequest: "Research after Stop",
        maxSearches: 3,
        maxResultsPerSearch: 3,
        ideaJobId: parentIdeaJobId,
        ideaJobPosition: 0,
      }),
    ).rejects.toThrow("Effective research root is stop-requested")
    expect(db.select().from(deepSearchJobs).all()).toEqual([])
    expect(mocks.runDeepSearchJob).not.toHaveBeenCalled()
  })

  it("rejects a root job when the user already has the active-job limit", async () => {
    db.insert(deepSearchJobs)
      .values(
        Array.from(
          { length: config.deepSearch.maxActiveRootJobsPerUser },
          (_, position) => ({
            deepSearchJobId: `active-root-${position}`,
            userId: "test-user-id",
            title: `Active root ${position}`,
            slug: `active-root-${position}`,
            researchRequest: "Research this",
            maxSearches: 3,
            maxResultsPerSearch: 3,
            strictQuality: false,
          }),
        ),
      )
      .run()

    await expect(
      createDeepSearchJobManager().start("test-user-id", {
        title: "One too many",
        researchRequest: "Research this",
        maxSearches: 3,
        maxResultsPerSearch: 3,
      }),
    ).rejects.toMatchObject({ status: 429 })
    expect(mocks.runDeepSearchJob).not.toHaveBeenCalled()
  })

  it("reserves root capacity before generating an asynchronous title", async () => {
    db.insert(deepSearchJobs)
      .values(
        Array.from(
          {
            length: config.deepSearch.maxActiveRootJobsPerUser - 1,
          },
          (_, position) => ({
            deepSearchJobId: `existing-root-${position}`,
            userId: "test-user-id",
            title: `Existing root ${position}`,
            slug: `existing-root-${position}`,
            researchRequest: "Research this",
            maxSearches: 3,
            maxResultsPerSearch: 3,
            strictQuality: false,
          }),
        ),
      )
      .run()
    const title = Promise.withResolvers<string>()
    mocks.generatePromptTitle.mockReturnValueOnce(title.promise)
    mocks.runDeepSearchJob.mockResolvedValue("Answer")
    const manager = createDeepSearchJobManager()

    const first = manager.start("test-user-id", {
      researchRequest: "First request",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })
    await vi.waitFor(() => {
      expect(mocks.generatePromptTitle).toHaveBeenCalledOnce()
    })

    await expect(
      manager.start("test-user-id", {
        researchRequest: "Second request",
        maxSearches: 3,
        maxResultsPerSearch: 3,
      }),
    ).rejects.toMatchObject({ status: 429 })
    expect(mocks.generatePromptTitle).toHaveBeenCalledOnce()

    title.resolve("First Request")
    await expect(first).resolves.toMatchObject({ title: "First Request" })
  })

  it("runs only the configured number of deep-search jobs concurrently", async () => {
    const parentIdeaJobId = "11111111-1111-4111-8111-111111111111"
    db.insert(ideaJobs)
      .values({
        ideaJobId: parentIdeaJobId,
        userId: "test-user-id",
        title: "Parent ideas",
        slug: "parent-ideas",
        prompt: "Generate ideas",
        numberOfIdeas: 12,
        deepSearchCount: 2,
        maxSearches: 3,
        maxResultsPerSearch: 3,
        maxRounds: 3,
      })
      .run()
    // Fill the remaining root slot. Child jobs must still be admitted because
    // they are bounded by the shared execution queue, not counted as roots.
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId: "active-standalone-root",
        userId: "test-user-id",
        title: "Active standalone root",
        slug: "active-standalone-root",
        researchRequest: "Research the root",
        maxSearches: 3,
        maxResultsPerSearch: 3,
        strictQuality: false,
      })
      .run()
    const totalJobs = config.deepSearch.maxConcurrentJobs + 1
    const completions = Array.from({ length: totalJobs }, () =>
      Promise.withResolvers<string>(),
    )
    let invocation = 0
    mocks.runDeepSearchJob.mockImplementation(() => {
      const completion = completions[invocation]
      invocation += 1
      if (!completion) throw new Error("Missing test completion")
      return completion.promise
    })
    const manager = createDeepSearchJobManager()

    const jobs = await Promise.all(
      completions.map((_, position) =>
        manager.start("test-user-id", {
          title: `Child search ${position}`,
          researchRequest: `Research child ${position}`,
          maxSearches: 3,
          maxResultsPerSearch: 3,
          ideaJobId: parentIdeaJobId,
          ideaJobPosition: position,
        }),
      ),
    )
    await vi.waitFor(() => {
      expect(mocks.runDeepSearchJob).toHaveBeenCalledTimes(
        config.deepSearch.maxConcurrentJobs,
      )
    })

    completions[0]?.resolve("First answer")
    await vi.waitFor(() => {
      expect(mocks.runDeepSearchJob).toHaveBeenCalledTimes(totalJobs)
    })
    for (const completion of completions.slice(1)) {
      completion.resolve("Later answer")
    }
    await Promise.all(jobs.map(({ completion }) => completion))
  })

  it("runs a newly admitted root before queued children from one batch", async () => {
    const parentIdeaJobId = "22222222-2222-4222-8222-222222222222"
    db.insert(ideaJobs)
      .values({
        ideaJobId: parentIdeaJobId,
        userId: "test-user-id",
        title: "Parent ideas",
        slug: "priority-parent-ideas",
        prompt: "Generate ideas",
        numberOfIdeas: 12,
        deepSearchCount: 2,
        maxSearches: 3,
        maxResultsPerSearch: 3,
        maxRounds: 3,
      })
      .run()
    db.insert(user)
      .values({
        id: "other-test-user-id",
        name: "Other Test User",
        email: "other-test-user@example.com",
        emailVerified: true,
      })
      .run()
    const totalJobs = config.deepSearch.maxConcurrentJobs + 2
    const completions = Array.from({ length: totalJobs }, () =>
      Promise.withResolvers<string>(),
    )
    let invocation = 0
    mocks.runDeepSearchJob.mockImplementation(() => {
      const completion = completions[invocation]
      invocation += 1
      if (!completion) throw new Error("Missing test completion")
      return completion.promise
    })
    const manager = createDeepSearchJobManager()
    const children = await Promise.all(
      Array.from(
        { length: config.deepSearch.maxConcurrentJobs + 1 },
        (_, position) =>
          manager.start("test-user-id", {
            title: `Child ${position}`,
            researchRequest: `Child request ${position}`,
            maxSearches: 3,
            maxResultsPerSearch: 3,
            ideaJobId: parentIdeaJobId,
            ideaJobPosition: position,
          }),
      ),
    )
    await vi.waitFor(() => {
      expect(mocks.runDeepSearchJob).toHaveBeenCalledTimes(
        config.deepSearch.maxConcurrentJobs,
      )
    })
    const root = await manager.start("other-test-user-id", {
      title: "Priority root",
      researchRequest: "Priority root request",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    completions[0]?.resolve("Completed child")
    await vi.waitFor(() => {
      expect(mocks.runDeepSearchJob).toHaveBeenCalledTimes(
        config.deepSearch.maxConcurrentJobs + 1,
      )
    })
    expect(
      mocks.runDeepSearchJob.mock.calls[
        config.deepSearch.maxConcurrentJobs
      ]?.[3],
    ).toBe("Priority root request")

    for (const completion of completions) completion.resolve("Answer")
    await Promise.all([
      ...children.map(({ completion }) => completion),
      root.completion,
    ])
  })

  it("accepts completed research when a selected page cannot be extracted", async () => {
    mocks.runDeepSearchJob.mockImplementation((deepSearchJobId: string) => {
      completeWithExtractionFailure(deepSearchJobId)
      return Promise.resolve("Completed answer")
    })
    const manager = createDeepSearchJobManager()
    const started = await manager.start("test-user-id", {
      researchRequest: "Research this",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    await expect(started.completion).resolves.toBe("Completed answer")
    expect(manager.getLiveJob(started.deepSearchJobId)).toBeUndefined()
  })

  it("keeps provider retry policy out of the workflow manager", async () => {
    mocks.runDeepSearchJob.mockImplementation((deepSearchJobId: string) => {
      completeWithExtractionFailure(deepSearchJobId)
      return Promise.resolve("Completed answer")
    })
    const started = await createDeepSearchJobManager().start("test-user-id", {
      researchRequest: "Research this",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    await expect(started.completion).resolves.toBe("Completed answer")
    expect(mocks.runDeepSearchJob).toHaveBeenCalledWith(
      started.deepSearchJobId,
      "test-user-id",
      expect.any(Object),
      "Research this",
      3,
      3,
      3,
      expect.any(AbortSignal),
    )
  })

  it("numbers repeated generated titles and slugs across users", async () => {
    mocks.runDeepSearchJob.mockImplementation((deepSearchJobId: string) => {
      db.update(deepSearchJobs)
        .set({
          status: "failed",
          error: "Stopped for identity test",
          completedAt: new Date(),
        })
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .run()
      return Promise.reject(new Error("Stopped for identity test"))
    })
    const manager = createDeepSearchJobManager()
    const first = await manager.start("test-user-id", {
      title: "London Energy Options",
      researchRequest: "Research this",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })
    await expect(first.completion).rejects.toThrow("Stopped for identity test")
    db.insert(user)
      .values({
        id: "other-test-user-id",
        name: "Other Test User",
        email: "other-test-user@example.com",
        emailVerified: true,
      })
      .run()
    const second = await manager.start("other-test-user-id", {
      title: "London Energy Options",
      researchRequest: "Research this again",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })
    await expect(second.completion).rejects.toThrow("Stopped for identity test")

    expect(first).toMatchObject({
      title: "London Energy Options",
      slug: "london-energy-options",
    })
    expect(second).toMatchObject({
      title: "London Energy Options 2",
      slug: "london-energy-options-2",
    })
  })

  it("retains its terminal live log when durable terminal persistence failed", async () => {
    mocks.runDeepSearchJob.mockImplementation(
      (
        _deepSearchJobId: string,
        _userId: string,
        job: LiveDeepSearchJob,
      ) => {
        job.publish({ type: "error", message: "SQLite unavailable" })
        job.publish({ type: "done" })
        job.close()
        return Promise.reject(new Error("SQLite unavailable"))
      },
    )
    const manager = createDeepSearchJobManager()
    const started = await manager.start("test-user-id", {
      researchRequest: "Research this",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    await expect(started.completion).rejects.toThrow("SQLite unavailable")
    expect(manager.getLiveJob(started.deepSearchJobId)).toBeDefined()
  })

  it("persists Stop before aborting and retains the registry until durable cleanup", async () => {
    const cleanup = Promise.withResolvers<string>()
    mocks.runDeepSearchJob.mockImplementation(
      (deepSearchJobId: string, ...args: unknown[]) => {
        const job = args[1] as LiveDeepSearchJob
        const signal = args.at(-1) as AbortSignal
        signal.addEventListener(
          "abort",
          () => {
            expect(
              db
                .select({ cancelRequestedAt: deepSearchJobs.cancelRequestedAt })
                .from(deepSearchJobs)
                .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
                .get()?.cancelRequestedAt,
            ).toBeInstanceOf(Date)
            db.update(deepSearchJobs)
              .set({
                status: "interrupted",
                error: "Workflow stopped by user",
                completedAt: new Date(),
              })
              .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
              .run()
            job.publish({
              type: "interrupted",
              message: "Workflow stopped by user",
            })
            job.publish({ type: "done" })
            job.close()
            cleanup.resolve("Stopped")
          },
          { once: true },
        )
        return cleanup.promise
      },
    )
    const manager = createDeepSearchJobManager()
    const started = await manager.start("test-user-id", {
      title: "Stop ordering",
      researchRequest: "Research this",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    const liveJob = manager.getLiveJob(started.deepSearchJobId)
    if (!liveJob) throw new Error("Expected a live direct deep-search job")
    expect(manager.stop("test-user-id", started.deepSearchJobId)).toMatchObject({
      kind: "requested",
      newlyRequested: true,
    })
    expect(manager.stop("test-user-id", started.deepSearchJobId)).toMatchObject({
      kind: "already-interrupted",
    })
    expect(manager.getLiveJob(started.deepSearchJobId)).toBeDefined()
    await expect(started.completion).resolves.toBe("Stopped")
    expect(await readEvents(liveJob)).toEqual([
      { type: "stop-requested" },
      { type: "interrupted", message: "Workflow stopped by user" },
      { type: "done" },
    ])
    expect(manager.getLiveJob(started.deepSearchJobId)).toBeUndefined()
  })

  it("waits for a stopped live execution before resuming it once", async () => {
    const stoppedRun = Promise.withResolvers<string>()
    const resumedRun = Promise.withResolvers<string>()
    mocks.runDeepSearchJob
      .mockReturnValueOnce(stoppedRun.promise)
      .mockReturnValueOnce(resumedRun.promise)
    const manager = createDeepSearchJobManager()
    const started = await manager.start("test-user-id", {
      title: "Resume after Stop",
      researchRequest: "Resume this immediately after Stop",
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    expect(manager.stop("test-user-id", started.deepSearchJobId)).toMatchObject({
      kind: "requested",
      newlyRequested: true,
    })
    const resumed = manager.resumeExisting(started.deepSearchJobId, {
      userId: "test-user-id",
    })
    const duplicate = manager.resumeExisting(started.deepSearchJobId, {
      userId: "test-user-id",
    })
    expect(mocks.runDeepSearchJob).toHaveBeenCalledOnce()

    interruptDeepSearchJob(started.deepSearchJobId)
    stoppedRun.reject(new WorkflowInterruptedError("user-stop"))
    await expect(started.completion).rejects.toThrow("Workflow stopped by user")
    await vi.waitFor(() => {
      expect(mocks.runDeepSearchJob).toHaveBeenCalledTimes(2)
    })

    resumedRun.resolve("Resumed answer")
    await expect(resumed.completion).resolves.toBe("Resumed answer")
    await expect(duplicate.completion).resolves.toBe("Resumed answer")
    expect(mocks.runDeepSearchJob).toHaveBeenCalledTimes(2)
  })

  it("keeps queued inherited Stop live events identical to durable replay", async () => {
    const blockingParentIdeaJobId = crypto.randomUUID()
    const stoppedParentIdeaJobId = crypto.randomUUID()
    db.insert(ideaJobs)
      .values([
        {
          ideaJobId: blockingParentIdeaJobId,
          userId: "test-user-id",
          title: "Blocking parent",
          slug: "blocking-parent",
          prompt: "Keep the queue occupied",
          numberOfIdeas: 8,
          deepSearchCount: 2,
          maxSearches: 3,
          maxResultsPerSearch: 3,
          maxRounds: 3,
        },
        {
          ideaJobId: stoppedParentIdeaJobId,
          userId: "test-user-id",
          title: "Stopped parent",
          slug: "stopped-parent",
          prompt: "Stop the queued child",
          numberOfIdeas: 8,
          deepSearchCount: 2,
          maxSearches: 3,
          maxResultsPerSearch: 3,
          maxRounds: 3,
        },
      ])
      .run()
    const blockers = Array.from(
      { length: config.deepSearch.maxConcurrentJobs },
      () => Promise.withResolvers<string>(),
    )
    let invocation = 0
    mocks.runDeepSearchJob.mockImplementation(() => {
      const blocker = blockers[invocation++]
      if (!blocker) throw new Error("Queued child unexpectedly started")
      return blocker.promise
    })
    const manager = createDeepSearchJobManager()
    const blockingJobs = await Promise.all(
      blockers.map((_, position) =>
        manager.start("test-user-id", {
          title: `Blocking child ${position}`,
          researchRequest: `Block queue slot ${position}`,
          maxSearches: 3,
          maxResultsPerSearch: 3,
          ideaJobId: blockingParentIdeaJobId,
          ideaJobPosition: position,
        }),
      ),
    )
    await vi.waitFor(() => {
      expect(mocks.runDeepSearchJob).toHaveBeenCalledTimes(blockers.length)
    })
    const parentController = new AbortController()
    const stopped = await manager.start(
      "test-user-id",
      {
        title: "Queued inherited Stop",
        researchRequest: "Never start this queued child",
        maxSearches: 3,
        maxResultsPerSearch: 3,
        ideaJobId: stoppedParentIdeaJobId,
        ideaJobPosition: 0,
      },
      { workflowSignal: parentController.signal },
    )
    const liveJob = manager.getLiveJob(stopped.deepSearchJobId)
    if (!liveJob) throw new Error("Expected a live queued deep-search job")

    db.update(ideaJobs)
      .set({ cancelRequestedAt: new Date() })
      .where(eq(ideaJobs.ideaJobId, stoppedParentIdeaJobId))
      .run()
    parentController.abort(workflowAbortReason("user-stop"))

    await expect(stopped.completion).rejects.toThrow(
      "Workflow stopped by parent",
    )
    for (const blocker of blockers) blocker.resolve("Completed blocker")
    await Promise.all(blockingJobs.map(({ completion }) => completion))
    const liveEvents = await readEvents(liveJob)
    expect(liveEvents).toEqual([
      { type: "stop-requested" },
      { type: "interrupted", message: "Workflow stopped by parent" },
      { type: "done" },
    ])
    expect(reconstructDeepSearchJobEvents(stopped.deepSearchJobId)).toEqual(
      liveEvents,
    )
    expect(mocks.runDeepSearchJob).toHaveBeenCalledTimes(blockers.length)
  })

  it("keeps active inherited Stop live events identical to durable replay", async () => {
    const parentIdeaJobId = crypto.randomUUID()
    db.insert(ideaJobs)
      .values({
        ideaJobId: parentIdeaJobId,
        userId: "test-user-id",
        title: "Active parent",
        slug: "active-parent",
        prompt: "Stop the active child",
        numberOfIdeas: 8,
        deepSearchCount: 2,
        maxSearches: 3,
        maxResultsPerSearch: 3,
        maxRounds: 3,
      })
      .run()
    mocks.runDeepSearchJob.mockImplementation(
      (
        deepSearchJobId: string,
        _userId: string,
        job: LiveDeepSearchJob,
        ...args: unknown[]
      ) => {
        const signal = args.at(-1) as AbortSignal
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              const interrupted = new WorkflowInterruptedError("parent-stop")
              db.update(deepSearchJobs)
                .set({
                  status: "interrupted",
                  error: interrupted.message,
                  completedAt: new Date(),
                })
                .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
                .run()
              job.publish({
                type: "interrupted",
                message: interrupted.message,
              })
              job.publish({ type: "done" })
              job.close()
              reject(interrupted)
            },
            { once: true },
          )
        })
      },
    )
    const manager = createDeepSearchJobManager()
    const parentController = new AbortController()
    const stopped = await manager.start(
      "test-user-id",
      {
        title: "Active inherited Stop",
        researchRequest: "Start then stop this child",
        maxSearches: 3,
        maxResultsPerSearch: 3,
        ideaJobId: parentIdeaJobId,
        ideaJobPosition: 0,
      },
      { workflowSignal: parentController.signal },
    )
    await vi.waitFor(() => expect(mocks.runDeepSearchJob).toHaveBeenCalledOnce())
    const liveJob = manager.getLiveJob(stopped.deepSearchJobId)
    if (!liveJob) throw new Error("Expected a live active deep-search job")

    db.update(ideaJobs)
      .set({ cancelRequestedAt: new Date() })
      .where(eq(ideaJobs.ideaJobId, parentIdeaJobId))
      .run()
    parentController.abort(workflowAbortReason("user-stop"))

    await expect(stopped.completion).rejects.toThrow(
      "Workflow stopped by parent",
    )
    const liveEvents = await readEvents(liveJob)
    expect(liveEvents).toEqual([
      { type: "stop-requested" },
      { type: "interrupted", message: "Workflow stopped by parent" },
      { type: "done" },
    ])
    expect(reconstructDeepSearchJobEvents(stopped.deepSearchJobId)).toEqual(
      liveEvents,
    )
  })
})
