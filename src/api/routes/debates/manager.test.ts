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
import { createDebateJobManager } from "./manager.ts"
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
      })
      .run()
    const ideaJobManager: IdeaJobManager = {
      start: vi.fn(),
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
})
