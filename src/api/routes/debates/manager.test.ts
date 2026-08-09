import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ runDebateJob: vi.fn() }))

vi.mock("./run.ts", () => ({ runDebateJob: mocks.runDebateJob }))

import { db } from "../../db/index.ts"
import { debateJobs, ideaJobs } from "../../db/schema/index.ts"
import type { IdeaJobManager } from "../ideas/manager.ts"
import { createDebateJobManager } from "./manager.ts"
import { DEBATE_TOURNAMENT_FORMAT } from "./tournament.ts"

describe("debate job manager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.delete(debateJobs).run()
  })

  it("disables retries for the complete debate-owned idea pipeline", async () => {
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
      },
    )

    expect(startIdeaJob).toHaveBeenCalledOnce()
    expect(startIdeaJob.mock.calls[0]?.[0]).toBe("test-user-id")
    expect(startIdeaJob.mock.calls[0]?.[1]).toEqual({
      prompt: "Debate products",
      numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
      deepSearchCount: 2,
      maxSearches: 3,
      maxResultsPerSearch: 3,
      maxRetries: 0,
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
})
