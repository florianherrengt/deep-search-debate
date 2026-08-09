import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  collectStreamText: vi.fn(),
  completeDebateMatch: vi.fn(),
  createAgentMessage: vi.fn(),
  createDebateRound: vi.fn(),
  generateObjectStream: vi.fn(),
  generateTextStream: vi.fn(),
  loadDebateContext: vi.fn(),
}))

vi.mock("../../helpers/collectStreamText.ts", () => ({
  collectStreamText: mocks.collectStreamText,
}))
vi.mock("../../llms/generateText.ts", () => ({
  generateObjectStream: mocks.generateObjectStream,
  generateTextStream: mocks.generateTextStream,
}))
vi.mock("./context.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context.ts")>()),
  loadDebateContext: mocks.loadDebateContext,
}))
vi.mock("./persistence.ts", () => ({
  completeDebateMatch: mocks.completeDebateMatch,
  createAgentMessage: mocks.createAgentMessage,
  createDebateRound: mocks.createDebateRound,
}))

import { db } from "../../db/index.ts"
import {
  debateJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { runDebateJob } from "./run.ts"
import type { DebateJobEvent } from "./schemas.ts"
import { DEBATE_TOURNAMENT_FORMAT } from "./tournament.ts"

async function collectEvents(
  events: AsyncIterable<DebateJobEvent>,
): Promise<DebateJobEvent[]> {
  const collected: DebateJobEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

describe("runDebateJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.delete(debateJobs).run()

    let generationNumber = 0
    mocks.generateTextStream.mockImplementation(() =>
      Promise.resolve({ id: `agent-${generationNumber += 1}` }),
    )
    mocks.generateObjectStream.mockImplementation(() => {
      const id = `judge-${generationNumber += 1}`
      return Promise.resolve({
        id,
        output: Promise.resolve({
          winnerSlot: 0,
          explanation: "Candidate A wins.",
        }),
      })
    })
    mocks.collectStreamText.mockImplementation(
      ({ id }: { id: string }) =>
        Promise.resolve(id === "agent-1" ? " \n" : "Substantive argument"),
    )
    mocks.createDebateRound.mockImplementation(
      ({ pairs }: { pairs: Array<readonly [string, string]> }) =>
        pairs.map(([firstIdeaId, secondIdeaId], position) => ({
          debateMatchId: `match-${generationNumber}-${position}`,
          firstIdeaId,
          secondIdeaId,
        })),
    )
    mocks.loadDebateContext.mockReturnValue({
      userRequest: "Choose a product",
      researchBriefing: "Research briefing",
      deepSearchResults: [
        { researchRequest: "Research this", answer: "Research answer" },
      ],
    })
  })

  it("fails without starting another round when an advocate returns only whitespace", async () => {
    const ideaJobId = crypto.randomUUID()
    const debateJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: "test-user-id",
        randomSeed: 42,
      })
      .run()
    db.insert(ideaJobs)
      .values({
        userId: "test-user-id",
        ideaJobId,
        debateJobId,
        prompt: "Choose a product",
        numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
        deepSearchCount: 1,
      })
      .run()
    const ideaRows = Array.from(
      { length: DEBATE_TOURNAMENT_FORMAT.participantCount },
      (_, position) => ({
        ideaId: crypto.randomUUID(),
        ideaJobId,
        position,
        title: `Idea ${position + 1}`,
        description: `Description ${position + 1}`,
        critiqueGenerationId: crypto.randomUUID(),
        selected: true,
      }),
    )
    db.insert(llmGenerations)
      .values(
        ideaRows.map(({ critiqueGenerationId }) => ({
          llmGenerationId: critiqueGenerationId,
          userId: "test-user-id",
          ideaJobId,
        })),
      )
      .run()
    db.insert(ideas).values(ideaRows).run()
    const job = createReplayableEventLog<DebateJobEvent>()
    const events = collectEvents(job.subscribe())
    await runDebateJob({
      debateJobId,
      userId: "test-user-id",
      ideaJobId,
      randomSeed: 42,
      ideaCompletion: Promise.resolve(),
      job,
    })

    expect(db.select().from(debateJobs).get()).toMatchObject({
      status: "failed",
      error: "Debate advocate returned an empty message",
    })
    expect(mocks.createDebateRound).toHaveBeenCalledOnce()
    const collectedEvents = await events
    expect(collectedEvents.slice(-2)).toEqual([
      {
        type: "error",
        message: "Debate advocate returned an empty message",
      },
      { type: "done" },
    ])
  })
})
