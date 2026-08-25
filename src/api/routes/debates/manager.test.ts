import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ runDebateJob: vi.fn() }))

vi.mock("./run.ts", () => ({ runDebateJob: mocks.runDebateJob }))

import { db } from "../../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs,
} from "../../db/schema/index.ts"
import type { IdeaJobManager } from "../ideas/manager.ts"
import { interruptDebateJob } from "./jobLifecycle.ts"
import { createDebateJobManager } from "./manager.ts"
import type { LiveDebateJob } from "./schemas.ts"
import { DEBATE_TOURNAMENT_FORMAT } from "./tournament.ts"

describe("debate job manager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.delete(debateJobs).run()
  })

  it("uses the SDK's bounded retries for the debate-owned idea pipeline", async () => {
    const ideaJobId = crypto.randomUUID()
    const startIdeaJob = vi.fn(
      (
        _userId: Parameters<IdeaJobManager["start"]>[0],
        _input: Parameters<IdeaJobManager["start"]>[1],
        options?: Parameters<IdeaJobManager["start"]>[2],
      ) => {
        db.transaction((transaction) => {
          const parent = options?.createParent?.(transaction, ideaJobId)
          transaction
            .insert(ideaJobs)
            .values({
              userId: "test-user-id",
              ideaJobId,
              ...parent,
              prompt: "Debate products",
              numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
              deepSearchCount: 2,
              maxSearches: 3,
              maxResultsPerSearch: 3,
              maxRounds: 3,
            })
            .run()
        })
        return Promise.resolve({
          ideaJobId,
          title: "Debate Products",
          slug: "debate-products",
          completion: Promise.resolve(),
        })
      },
    )
    const ideaJobManager: IdeaJobManager = {
      start: startIdeaJob,
      resumeExisting: vi.fn(),
      stop: vi.fn(),
      getLiveJob: vi.fn(),
    }
    mocks.runDebateJob.mockImplementation(
      ({ debateJobId }: { debateJobId: string }) => {
        db.update(debateJobs)
          .set({
            stage: "final",
            status: "completed",
            completedAt: new Date(),
          })
          .run()
        expect(debateJobId).toBeTypeOf("string")
        return Promise.resolve()
      },
    )

    const started = await createDebateJobManager(ideaJobManager).start(
      "test-user-id",
      {
        prompt: "Debate products",
        isPublic: true,
        numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
        deepSearchCount: 1,
        maxSearches: 1,
        maxResultsPerSearch: 1,
        maxRounds: 1,
      },
    )

    expect(startIdeaJob).toHaveBeenCalledOnce()
    expect(startIdeaJob.mock.calls[0]?.[0]).toBe("test-user-id")
    expect(startIdeaJob.mock.calls[0]?.[1]).toEqual({
      prompt: "Debate products",
      numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
      deepSearchCount: 1,
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
    })
    expect(startIdeaJob.mock.calls[0]?.[2]?.createParent).toBeTypeOf(
      "function",
    )
    expect(
      db
        .select({ isPublic: debateJobs.isPublic })
        .from(debateJobs)
        .get()?.isPublic,
    ).toBe(true)
    await expect(started.completion).resolves.toBeUndefined()
  })

  it("reopens and deduplicates a persisted interrupted debate", async () => {
    const debateJobId = crypto.randomUUID()
    const ideaJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: "test-user-id",
        randomSeed: 4,
        status: "interrupted",
        error: "Server stopped",
        completedAt: new Date(),
      })
      .run()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        debateJobId,
        userId: "test-user-id",
        title: "Interrupted debate",
        slug: "interrupted-debate",
        prompt: "Resume this debate",
        numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
        deepSearchCount: 1,
        maxSearches: 1,
        maxResultsPerSearch: 1,
        maxRounds: 1,
        status: "interrupted",
        error: "Parent stopped",
        completedAt: new Date(),
      })
      .run()
    const completion = Promise.withResolvers<void>()
    mocks.runDebateJob.mockImplementation(async () => {
      await completion.promise
      db.update(debateJobs)
        .set({ stage: "final", status: "completed", completedAt: new Date() })
        .run()
    })
    const ideaJobManager: IdeaJobManager = {
      start: vi.fn(),
      resumeExisting: vi.fn(),
      stop: vi.fn(),
      getLiveJob: vi.fn(),
    }
    const manager = createDebateJobManager(ideaJobManager)

    const first = manager.resumeExisting(debateJobId, {
      userId: "test-user-id",
    })
    const duplicate = manager.resumeExisting(debateJobId, {
      userId: "test-user-id",
    })

    expect(duplicate.completion).toBe(first.completion)
    expect(mocks.runDebateJob).toHaveBeenCalledOnce()
    const liveJob = (
      mocks.runDebateJob.mock.calls[0]?.[0] as
        | { job: LiveDebateJob }
        | undefined
    )?.job
    if (!liveJob) throw new Error("Expected a resumed live debate job")
    const events = liveJob.subscribe()
    await expect(events.next()).resolves.toEqual({
      done: false,
      value: { type: "updated" },
    })
    await events.return(undefined)
    expect(db.select({ status: debateJobs.status }).from(debateJobs).get()).toEqual(
      { status: "running" },
    )
    completion.resolve()
    await expect(first.completion).resolves.toBeUndefined()
  })

  it("settles a persisted Stop when no live controller exists", () => {
    const debateJobId = crypto.randomUUID()
    const ideaJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({ debateJobId, userId: "test-user-id", randomSeed: 4 })
      .run()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        debateJobId,
        userId: "test-user-id",
        prompt: "Stop an orphaned debate",
        numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
        deepSearchCount: 1,
        maxSearches: 1,
        maxResultsPerSearch: 1,
        maxRounds: 1,
      })
      .run()
    const deepSearchJobId = crypto.randomUUID()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId,
        ideaJobId,
        ideaJobPosition: 0,
        userId: "test-user-id",
        researchRequest: "Owned research still in progress",
        maxSearches: 1,
        maxResultsPerSearch: 1,
        maxRounds: 1,
        strictQuality: true,
      })
      .run()
    const ideaJobManager: IdeaJobManager = {
      start: vi.fn(),
      resumeExisting: vi.fn(),
      stop: vi.fn(),
      getLiveJob: vi.fn(),
    }

    const result = createDebateJobManager(ideaJobManager).stop(
      "test-user-id",
      debateJobId,
    )

    expect(result).toMatchObject({ kind: "requested", newlyRequested: true })
    expect(db.select().from(debateJobs).get()).toMatchObject({
      status: "interrupted",
      error: "Workflow stopped by user",
    })
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "interrupted",
      error: "Workflow stopped by parent",
    })
    expect(db.select().from(deepSearchJobs).get()).toMatchObject({
      status: "interrupted",
      error: "Workflow stopped by parent",
    })
  })

  it("waits for a stopped live execution before resuming it once", async () => {
    const debateJobId = crypto.randomUUID()
    const ideaJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: "test-user-id",
        randomSeed: 4,
        status: "interrupted",
        error: "Server stopped",
        completedAt: new Date(),
      })
      .run()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        debateJobId,
        userId: "test-user-id",
        title: "Resume debate after Stop",
        slug: "resume-debate-after-stop",
        prompt: "Resume this debate immediately after Stop",
        numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
        deepSearchCount: 1,
        maxSearches: 1,
        maxResultsPerSearch: 1,
        maxRounds: 1,
        status: "interrupted",
        error: "Parent stopped",
        completedAt: new Date(),
      })
      .run()
    const stoppedRun = Promise.withResolvers<void>()
    const resumedRun = Promise.withResolvers<void>()
    mocks.runDebateJob
      .mockReturnValueOnce(stoppedRun.promise)
      .mockReturnValueOnce(resumedRun.promise)
    const ideaJobManager: IdeaJobManager = {
      start: vi.fn(),
      resumeExisting: vi.fn(),
      stop: vi.fn(),
      getLiveJob: vi.fn(),
    }
    const manager = createDebateJobManager(ideaJobManager)
    const started = manager.resumeExisting(debateJobId, {
      userId: "test-user-id",
    })

    expect(manager.stop("test-user-id", debateJobId)).toMatchObject({
      kind: "requested",
      newlyRequested: true,
    })
    const resumed = manager.resumeExisting(debateJobId, {
      userId: "test-user-id",
    })
    const duplicate = manager.resumeExisting(debateJobId, {
      userId: "test-user-id",
    })
    expect(mocks.runDebateJob).toHaveBeenCalledOnce()

    interruptDebateJob(debateJobId, "Workflow stopped by user")
    stoppedRun.reject(new Error("Workflow stopped by user"))
    await expect(started.completion).rejects.toThrow("Workflow stopped by user")
    await vi.waitFor(() => {
      expect(mocks.runDebateJob).toHaveBeenCalledTimes(2)
    })

    resumedRun.reject(new Error("Resumed execution failed"))
    await expect(resumed.completion).rejects.toThrow("Resumed execution failed")
    await expect(duplicate.completion).rejects.toThrow(
      "Resumed execution failed",
    )
    expect(mocks.runDebateJob).toHaveBeenCalledTimes(2)
  })
})
