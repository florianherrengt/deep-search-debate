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
    db.delete(ideaJobs).run()
  })

  it("disables retries for the complete debate-owned idea pipeline", async () => {
    const ideaJobId = crypto.randomUUID()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        prompt: "Debate products",
        numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
        deepSearchCount: 2,
      })
      .run()
    const startIdeaJob = vi.fn(
      (
        _input: Parameters<IdeaJobManager["start"]>[0],
        options?: Parameters<IdeaJobManager["start"]>[1],
      ) => {
        db.transaction((transaction) => {
          options?.createRelated?.(transaction, ideaJobId)
        })
        return {
          ideaJobId,
          completion: Promise.resolve(),
        }
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

    const started = createDebateJobManager(ideaJobManager).start({
      prompt: "Debate products",
    })

    expect(startIdeaJob).toHaveBeenCalledOnce()
    expect(startIdeaJob.mock.calls[0]?.[0]).toEqual({
      prompt: "Debate products",
      numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
      deepSearchCount: 2,
      maxSearches: 3,
      maxResultsPerSearch: 3,
      maxRetries: 0,
    })
    expect(startIdeaJob.mock.calls[0]?.[1]?.createRelated).toBeTypeOf(
      "function",
    )
    await expect(started.completion).resolves.toBeUndefined()
  })
})
