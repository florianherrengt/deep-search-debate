import { beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"

const mocks = vi.hoisted(() => ({
  completeDebateMatch: vi.fn(),
  createAgentMessage: vi.fn(),
  createDebateRound: vi.fn(),
  generateObjectStream: vi.fn(),
  generateTextStream: vi.fn(),
  loadDebateCandidateResearch: vi.fn(),
  loadDebateContext: vi.fn(),
  loadDebateExecutionSnapshot: vi.fn(),
  loadDebateMatch: vi.fn(),
  replaceFailedAgentMessageGeneration: vi.fn(),
  persistedMatches: new Map<string, {
    debateMatchId: string
    position: number
    firstIdeaId: string
    secondIdeaId: string
    winnerIdeaId: string | null
    completedAt: Date | null
    messages: Array<{
      debateMessageId: string
      position: number
      speakerSlot: 0 | 1 | 2
      generation: {
        generationId: string
        status: "running" | "completed" | "failed" | "interrupted"
        text: string | null
        error: string | null
      }
    }>
  }>(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateObjectStream: mocks.generateObjectStream,
  generateTextStream: mocks.generateTextStream,
}))
vi.mock("./context.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context.ts")>()),
  loadDebateCandidateResearch: mocks.loadDebateCandidateResearch,
  loadDebateContext: mocks.loadDebateContext,
}))
vi.mock("./persistence.ts", () => ({
  completeDebateMatch: mocks.completeDebateMatch,
  createAgentMessage: mocks.createAgentMessage,
  createDebateRound: mocks.createDebateRound,
  loadDebateExecutionSnapshot: mocks.loadDebateExecutionSnapshot,
  loadDebateMatch: mocks.loadDebateMatch,
  replaceFailedAgentMessageGeneration:
    mocks.replaceFailedAgentMessageGeneration,
}))
// Unit tests never launch a browser; the winner-site screenshot is a stub.
vi.mock("puppeteer", () => ({
  default: {
    launch: vi.fn(() =>
      Promise.resolve({
        newPage: () =>
          Promise.resolve({
            setViewport: () => Promise.resolve(),
            goto: () => Promise.resolve(),
            screenshot: () => Promise.resolve(new Uint8Array([1, 2, 3])),
          }),
        close: () => Promise.resolve(),
      }),
    ),
  },
}))

import { db } from "../../db/index.ts"
import {
  debateJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { config } from "../../config.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { workflowAbortReason } from "../../workflowRuntime.ts"
import { runDebateJob } from "./run.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  judgeVerdictSchema,
  type DebateJobEvent,
} from "./schemas.ts"
import {
  DEBATE_TOURNAMENT_FORMAT,
  getTotalMatchCount,
} from "./tournament.ts"

async function collectEvents(
  events: AsyncIterable<DebateJobEvent>,
): Promise<DebateJobEvent[]> {
  const collected: DebateJobEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}


type SiteCallInput = {
  owner: { debateJobId?: string }
  onRegistered?: (
    id: string,
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => void
}

/** Persists the mocked winner-site generation exactly like the real stream. */
function completeWinnerSiteGeneration(input: SiteCallInput): {
  id: string
  completion: Promise<{
    status: "completed"
    text: string
    reasoning: string
  }>
} {
  const id = crypto.randomUUID()
  const html = "<!DOCTYPE html><html><body>Winner website</body></html>"
  db.transaction((transaction) => {
    transaction
      .insert(llmGenerations)
      .values({
        llmGenerationId: id,
        userId: "test-user-id",
        debateJobId: input.owner.debateJobId!,
        promptName: PromptName.CreateIdeaSite,
        status: "completed",
        text: html,
        reasoning: "",
        completedAt: new Date(),
      })
      .run()
    input.onRegistered?.(id, transaction)
  })
  return {
    id,
    completion: Promise.resolve({
      status: "completed" as const,
      text: html,
      reasoning: "" as const,
    }),
  }
}

function createMockMatches(
  pairs: Array<readonly [string, string]>,
): Array<NonNullable<ReturnType<typeof mocks.persistedMatches.get>>> {
  return pairs.map(([firstIdeaId, secondIdeaId], position) => {
    const match = {
      debateMatchId: crypto.randomUUID(),
      position,
      firstIdeaId,
      secondIdeaId,
      winnerIdeaId: null,
      completedAt: null,
      messages: [],
    }
    mocks.persistedMatches.set(match.debateMatchId, match)
    return match
  })
}

function createRunFixture() {
  const ideaJobId = crypto.randomUUID()
  const debateJobId = crypto.randomUUID()
  const pipelineGenerationIds = Array.from({ length: 4 }, () =>
    crypto.randomUUID(),
  )
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
      numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.minParticipantCount,
      deepSearchCount: 1,
      maxSearches: 2,
      maxResultsPerSearch: 2,
      maxRounds: 1,
    })
    .run()
  const ideaRows = Array.from(
    { length: DEBATE_TOURNAMENT_FORMAT.minParticipantCount },
    (_, position) => ({
      ideaId: crypto.randomUUID(),
      ideaJobId,
      position,
      title: `Idea ${position + 1}`,
      description: `Description ${position + 1}`,
      evaluationGenerationId: crypto.randomUUID(),
      refinementGenerationId: crypto.randomUUID(),
      refinedTitle: `Improved idea ${position + 1}`,
      refinedDescription: `Improved description ${position + 1}`,
      selected: true,
    }),
  )
  db.insert(llmGenerations)
    .values(
      [
        ...pipelineGenerationIds.map((llmGenerationId) => ({
          llmGenerationId,
          userId: "test-user-id",
          ideaJobId,
          promptName: "fixture-pipeline",
          status: "completed" as const,
          text: "Fixture pipeline output",
          reasoning: "Fixture reasoning",
          completedAt: new Date(),
        })),
        ...ideaRows.flatMap(
          ({ evaluationGenerationId, refinementGenerationId }) => [
          {
            llmGenerationId: evaluationGenerationId,
            userId: "test-user-id",
            ideaJobId,
          },
          {
            llmGenerationId: refinementGenerationId,
            userId: "test-user-id",
            ideaJobId,
          },
          ],
        ),
      ],
    )
    .run()
  db.insert(ideas).values(ideaRows).run()
  db.update(ideaJobs)
    .set({
      stage: "ideas",
      status: "completed",
      researchPromptGenerationId: pipelineGenerationIds[0],
      researchSummaryGenerationId: pipelineGenerationIds[1],
      ideaGenerationId: pipelineGenerationIds[2],
      selectionGenerationId: pipelineGenerationIds[3],
      completedAt: new Date(),
    })
    .where(eq(ideaJobs.ideaJobId, ideaJobId))
    .run()
  mocks.loadDebateCandidateResearch.mockReturnValue(
    new Map(
      ideaRows.map(({ ideaId }, position) => [
        ideaId,
        {
          researchRequest: `Research request ${position + 1}`,
          answer: `Research answer ${position + 1}`,
        },
      ]),
    ),
  )
  mocks.loadDebateExecutionSnapshot.mockImplementation((id: string) =>
    id === debateJobId
      ? {
          debate: { debateJobId, userId: "test-user-id", randomSeed: 42 },
          ideaJob: { ideaJobId, status: "completed", error: null },
          selectedIdeas: ideaRows,
          rounds: [],
          websiteGeneration: null,
        }
      : undefined,
  )
  const ideaJobManager = {
    resumeExisting: vi.fn(() => ({ completion: Promise.resolve() })),
  }
  const job = createReplayableEventLog<DebateJobEvent>()
  return {
    debateJobId,
    ideaJobId,
    ideaJobManager,
    job,
    events: collectEvents(job.subscribe()),
  }
}

describe("judge verdict contract", () => {
  it("requires explicit candidate labels for new verdicts", () => {
    expect(
      judgeVerdictSchema.parse({
        winner: "candidate_a",
        explanation: "Candidate A wins.",
      }),
    ).toEqual({
      winner: "candidate_a",
      explanation: "Candidate A wins.",
    })
    expect(() =>
      judgeVerdictSchema.parse({
        winnerSlot: 0,
        explanation: "Candidate A wins.",
      }),
    ).toThrow()
  })
})

describe("runDebateJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.persistedMatches.clear()
    db.delete(debateJobs).run()

    mocks.loadDebateMatch.mockImplementation((matchId: string) =>
      mocks.persistedMatches.get(matchId),
    )
    mocks.createAgentMessage.mockImplementation((input: {
      debateMatchId: string
      position: number
      speakerSlot: 0 | 1 | 2
      llmGenerationId: string
    }) => {
      const match = mocks.persistedMatches.get(input.debateMatchId)
      if (!match) throw new Error("Debate match was not found")
      match.messages.push({
        debateMessageId: crypto.randomUUID(),
        position: input.position,
        speakerSlot: input.speakerSlot,
        generation: {
          generationId: input.llmGenerationId,
          status: "running",
          text: null,
          error: null,
        },
      })
    })
    mocks.replaceFailedAgentMessageGeneration.mockImplementation((input: {
      debateMatchId: string
      position: number
      retryGenerationId: string
    }) => {
      const message = mocks.persistedMatches
        .get(input.debateMatchId)
        ?.messages.find(({ position }) => position === input.position)
      if (!message) throw new Error("Debate message was not found")
      message.generation = {
        generationId: input.retryGenerationId,
        status: "running",
        text: null,
        error: null,
      }
    })

    let generationNumber = 0
    mocks.generateTextStream.mockImplementation((input: {
      promptName?: string
      owner: { debateJobId?: string }
      onRegistered?: (
        id: string,
        transaction: { kind: string },
      ) => void
    }) => {
      if (input.promptName === PromptName.CreateIdeaSite) {
        return completeWinnerSiteGeneration(
          input as Parameters<typeof completeWinnerSiteGeneration>[0],
        )
      }
      const id = `agent-${generationNumber += 1}`
      const transaction = { kind: "registration-transaction" }
      input.onRegistered?.(id, transaction)
      return Promise.resolve({
        id,
        completion: Promise.resolve({
          status: "completed" as const,
          text: id === "agent-1" ? " \n" : "Substantive argument",
          reasoning: "",
        }),
      })
    })
    mocks.generateObjectStream.mockImplementation((input: {
      onRegistered?: (id: string, transaction: { kind: string }) => void
      onCompleted?: (
        result: {
          id: string
          output: { winner: "candidate_a"; explanation: string }
        },
        transaction: { kind: string },
      ) => void
    }) => {
      const id = `judge-${generationNumber += 1}`
      const verdict = {
        winner: "candidate_a" as const,
        explanation: "Candidate A wins.",
      }
      input.onRegistered?.(id, { kind: "registration-transaction" })
      input.onCompleted?.(
        { id, output: verdict },
        { kind: "completion-transaction" },
      )
      return Promise.resolve({
        id,
        output: Promise.resolve(verdict),
        completion: Promise.resolve({
          status: "completed" as const,
          text: JSON.stringify(verdict),
          reasoning: "",
        }),
      })
    })
    mocks.createDebateRound.mockImplementation(
      ({ pairs }: { pairs: Array<readonly [string, string]> }) =>
        createMockMatches(pairs),
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
    const { debateJobId, ideaJobManager, job, events } = createRunFixture()
    await runDebateJob({
      debateJobId,
      ideaJobManager,
      job,
    })

    expect(db.select().from(debateJobs).get()).toMatchObject({
      status: "failed",
      error: "Debate advocate returned an empty message",
    })
    expect(mocks.createDebateRound).toHaveBeenCalledOnce()
    expect(mocks.createAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({ llmGenerationId: "agent-1" }),
      { kind: "registration-transaction" },
    )
    expect(mocks.generateTextStream).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: "disabled" }),
    )
    const collectedEvents = await events
    expect(collectedEvents.slice(-2)).toEqual([
      {
        type: "error",
        message: "Debate advocate returned an empty message",
      },
      { type: "done" },
    ])
  })

  it("retries one transient other finish and completes the tournament", async () => {
    let advocateGenerationNumber = 0
    mocks.generateTextStream.mockImplementation((input: {
      promptName?: string
      owner: { debateJobId?: string }
      onRegistered?: (
        id: string,
        transaction: { kind: string },
      ) => void
    }) => {
      if (input.promptName === PromptName.CreateIdeaSite) {
        return completeWinnerSiteGeneration(
          input as Parameters<typeof completeWinnerSiteGeneration>[0],
        )
      }
      const id = `retry-agent-${advocateGenerationNumber += 1}`
      const transaction = { kind: "registration-transaction" }
      input.onRegistered?.(id, transaction)
      return Promise.resolve({
        id,
        completion: Promise.resolve(
          advocateGenerationNumber === 1
            ? {
                status: "failed" as const,
                text: "Partial opening:",
                reasoning: "",
                error: 'Text generation ended with finish reason "other"',
                finishReason: "other" as const,
                failureKind: "finish-reason" as const,
              }
            : {
                status: "completed" as const,
                text: "Substantive argument",
                reasoning: "",
                finishReason: "stop" as const,
              },
        ),
      })
    })
    const { debateJobId, ideaJobId, ideaJobManager, job, events } = createRunFixture()

    await runDebateJob({
      debateJobId,
      ideaJobManager,
      job,
    })

    const debate = db.select().from(debateJobs).get()
    expect(debate).toMatchObject({
      stage: "final",
      status: "completed",
      error: null,
    })
    // The tournament winner's website generation is linked, completed, and
    // stored under the winning idea's site directory before completion.
    expect(debate?.websiteGenerationId).toEqual(expect.any(String))
    expect(
      db
        .select({ promptName: llmGenerations.promptName })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, debate!.websiteGenerationId!))
        .get(),
    ).toMatchObject({ promptName: PromptName.CreateIdeaSite })
    const winnerIdeas = db
      .select({ ideaId: ideas.ideaId })
      .from(ideas)
      .where(eq(ideas.ideaJobId, ideaJobId))
      .all()
    expect(
      winnerIdeas.some(({ ideaId }) =>
        existsSync(join(config.ideaSites.dir, ideaId, "websites", "index.html")),
      ),
    ).toBe(true)
    const firstLink = mocks.createAgentMessage.mock.calls[0]?.[0] as {
      debateMatchId: string
      position: number
      llmGenerationId: string
    }
    expect(firstLink.llmGenerationId).toBe("retry-agent-1")
    expect(mocks.generateTextStream.mock.calls[0]?.[0]).not.toHaveProperty(
      "maxRetries",
    )
    const retryLink = mocks.replaceFailedAgentMessageGeneration.mock
      .calls[0]?.[0] as unknown as {
        debateMatchId: string
        position: number
        failedGenerationId: string
        retryGenerationId: string
      }
    expect(retryLink).toMatchObject({
      debateMatchId: firstLink.debateMatchId,
      position: firstLink.position,
      failedGenerationId: "retry-agent-1",
    })
    expect(retryLink.retryGenerationId).toMatch(/^retry-agent-/)
    expect(
      mocks.replaceFailedAgentMessageGeneration.mock.calls[0]?.[1],
    ).toEqual({ kind: "registration-transaction" })
    expect(await events).not.toContainEqual(expect.objectContaining({
      type: "error",
    }))
  })

  it("fails after exactly one retry when other happens twice", async () => {
    let advocateGenerationNumber = 0
    mocks.generateTextStream.mockImplementation((input: {
      onRegistered?: (
        id: string,
        transaction: { kind: string },
      ) => void
    }) => {
      const id = `bounded-agent-${advocateGenerationNumber += 1}`
      input.onRegistered?.(id, { kind: "registration-transaction" })
      return Promise.resolve({
        id,
        completion: Promise.resolve({
          status: "failed" as const,
          text: "Partial opening:",
          reasoning: "",
          error: 'Text generation ended with finish reason "other"',
          failureKind: "finish-reason" as const,
          finishReason: "other" as const,
        }),
      })
    })
    const { debateJobId, ideaJobManager, job } = createRunFixture()

    await runDebateJob({
      debateJobId,
      ideaJobManager,
      job,
    })

    expect(db.select().from(debateJobs).get()).toMatchObject({
      stage: "swiss",
      status: "failed",
      error: 'Text generation ended with finish reason "other"',
    })
    expect(mocks.generateTextStream).toHaveBeenCalledTimes(
      DEBATE_TOURNAMENT_FORMAT.minParticipantCount * 2,
    )
    expect(mocks.createAgentMessage).toHaveBeenCalledTimes(
      DEBATE_TOURNAMENT_FORMAT.minParticipantCount,
    )
    expect(mocks.replaceFailedAgentMessageGeneration).toHaveBeenCalledTimes(
      DEBATE_TOURNAMENT_FORMAT.minParticipantCount,
    )
    expect(mocks.createDebateRound).toHaveBeenCalledOnce()
  })

  it.each(["length", "content-filter"] as const)(
    "does not retry a %s finish",
    async (finishReason) => {
    let advocateGenerationNumber = 0
    mocks.generateTextStream.mockImplementation((input: {
      onRegistered?: (
        id: string,
        transaction: { kind: string },
      ) => void
    }) => {
      const id = `non-retry-agent-${advocateGenerationNumber += 1}`
      input.onRegistered?.(id, { kind: "registration-transaction" })
      return Promise.resolve({
        id,
        completion: Promise.resolve({
          status: "failed" as const,
          text: "Partial opening",
          reasoning: "",
          error: `Text generation ended with finish reason "${finishReason}"`,
          failureKind: "finish-reason" as const,
          finishReason,
        }),
      })
    })
    const { debateJobId, ideaJobManager, job } = createRunFixture()

    await runDebateJob({
      debateJobId,
      ideaJobManager,
      job,
    })

    expect(db.select().from(debateJobs).get()).toMatchObject({
      status: "failed",
      error: `Text generation ended with finish reason "${finishReason}"`,
    })
    expect(mocks.generateTextStream).toHaveBeenCalledTimes(
      DEBATE_TOURNAMENT_FORMAT.minParticipantCount,
    )
    expect(mocks.replaceFailedAgentMessageGeneration).not.toHaveBeenCalled()
    },
  )

  it("does not retry a stream failure carrying an other finish", async () => {
    let advocateGenerationNumber = 0
    mocks.generateTextStream.mockImplementation((input: {
      onRegistered?: (
        id: string,
        transaction: { kind: string },
      ) => void
    }) => {
      const id = `stream-agent-${advocateGenerationNumber += 1}`
      input.onRegistered?.(id, { kind: "registration-transaction" })
      return Promise.resolve({
        id,
        completion: Promise.resolve({
          status: "failed" as const,
          text: "Partial opening",
          reasoning: "",
          error: "Provider stream disconnected",
          failureKind: "stream" as const,
          finishReason: "other" as const,
        }),
      })
    })
    const { debateJobId, ideaJobManager, job } = createRunFixture()

    await runDebateJob({
      debateJobId,
      ideaJobManager,
      job,
    })

    expect(db.select().from(debateJobs).get()).toMatchObject({
      status: "failed",
      error: "Provider stream disconnected",
    })
    expect(mocks.generateTextStream).toHaveBeenCalledTimes(
      DEBATE_TOURNAMENT_FORMAT.minParticipantCount,
    )
    expect(mocks.replaceFailedAgentMessageGeneration).not.toHaveBeenCalled()
  })

  it.each([
    { checkpoint: "missing", status: null },
    { checkpoint: "completed", status: "completed" as const },
    { checkpoint: "failed", status: "failed" as const },
    { checkpoint: "interrupted", status: "interrupted" as const },
  ])(
    "reconciles a $checkpoint advocate checkpoint without growing durable counts",
    async ({ status }) => {
      let advocateGenerationNumber = 0
      mocks.generateTextStream.mockImplementation((input: {
        promptName?: string
        owner: { debateJobId?: string }
        onRegistered?: (
          id: string,
          transaction: { kind: string },
        ) => void
      }) => {
        if (input.promptName === PromptName.CreateIdeaSite) {
          return completeWinnerSiteGeneration(
            input as Parameters<typeof completeWinnerSiteGeneration>[0],
          )
        }
        const id = `checkpoint-agent-${advocateGenerationNumber += 1}`
        input.onRegistered?.(id, { kind: "registration-transaction" })
        return Promise.resolve({
          id,
          completion: Promise.resolve({
            status: "completed" as const,
            text: "Recovered substantive argument",
            reasoning: "",
            finishReason: "stop" as const,
          }),
        })
      })
      mocks.createDebateRound.mockImplementationOnce(
        ({ pairs }: { pairs: Array<readonly [string, string]> }) => {
          const matches = createMockMatches(pairs)
          if (status !== null) {
            matches[0]?.messages.push({
              debateMessageId: crypto.randomUUID(),
              position: 0,
              speakerSlot: 0,
              generation: {
                generationId: `persisted-${status}`,
                status,
                text:
                  status === "completed"
                    ? "Persisted opening"
                    : "Partial opening",
                error:
                  status === "completed"
                    ? null
                    : `Persisted ${status} attempt`,
              },
            })
          }
          return matches
        },
      )
      const fixture = createRunFixture()

      await runDebateJob({
        debateJobId: fixture.debateJobId,
        ideaJobManager: fixture.ideaJobManager,
        job: fixture.job,
      })

      expect(db.select().from(debateJobs).get()).toMatchObject({
        status: "completed",
      })
      expect(fixture.ideaJobManager.resumeExisting).toHaveBeenCalledOnce()
      const advocateCalls = mocks.generateTextStream.mock.calls.filter(
        ([input]) =>
          (input as { promptName?: string }).promptName !==
          PromptName.CreateIdeaSite,
      )
      expect(advocateCalls).toHaveLength(
        getTotalMatchCount(DEBATE_TOURNAMENT_FORMAT.minParticipantCount) * 4 -
          (status === "completed" ? 1 : 0),
      )
      expect(mocks.replaceFailedAgentMessageGeneration).toHaveBeenCalledTimes(
        status === "failed" || status === "interrupted" ? 1 : 0,
      )
      expect(mocks.persistedMatches.size).toBe(
        getTotalMatchCount(DEBATE_TOURNAMENT_FORMAT.minParticipantCount),
      )
      expect(
        [...mocks.persistedMatches.values()].reduce(
          (count, match) => count + match.messages.length,
          0,
        ),
      ).toBe(
        getTotalMatchCount(DEBATE_TOURNAMENT_FORMAT.minParticipantCount) * 5,
      )
      await fixture.events
    },
  )

  it("retries one transient judge other finish", async () => {
    let advocateGenerationNumber = 0
    mocks.generateTextStream.mockImplementation((input: {
      promptName?: string
      owner: { debateJobId?: string }
      onRegistered?: (
        id: string,
        transaction: { kind: string },
      ) => void
    }) => {
      if (input.promptName === PromptName.CreateIdeaSite) {
        return completeWinnerSiteGeneration(
          input as Parameters<typeof completeWinnerSiteGeneration>[0],
        )
      }
      const id = `judge-test-agent-${advocateGenerationNumber += 1}`
      input.onRegistered?.(id, { kind: "registration-transaction" })
      return Promise.resolve({
        id,
        completion: Promise.resolve({
          status: "completed" as const,
          text: "Substantive argument",
          reasoning: "",
          finishReason: "stop" as const,
        }),
      })
    })
    let judgeGenerationNumber = 0
    mocks.generateObjectStream.mockImplementation((input: {
      onCompleted?: (
        result: {
          id: string
          output: {
            winner: "candidate_a" | "candidate_b"
            explanation: string
          }
        },
        transaction: { kind: string },
      ) => void
    }) => {
      const isFirst = judgeGenerationNumber === 0
      const id = `retry-judge-${judgeGenerationNumber += 1}`
      const verdict = {
        winner: "candidate_b" as const,
        explanation: "Candidate B wins.",
      }
      if (!isFirst) {
        input.onCompleted?.(
          { id, output: verdict },
          { kind: "completion-transaction" },
        )
      }
      return Promise.resolve({
        id,
        output: isFirst
          ? Promise.reject(new Error("Incomplete judge JSON"))
          : Promise.resolve(verdict),
        completion: Promise.resolve(
          isFirst
            ? {
                status: "failed" as const,
                text: "{",
                reasoning: "",
                error: 'Text generation ended with finish reason "other"',
                failureKind: "finish-reason" as const,
                finishReason: "other" as const,
              }
            : {
                status: "completed" as const,
                text: JSON.stringify({
                  winner: "candidate_b",
                  explanation: "Candidate B wins.",
                }),
                reasoning: "",
                finishReason: "stop" as const,
              },
        ),
      })
    })
    const { debateJobId, ideaJobManager, job } = createRunFixture()

    await runDebateJob({
      debateJobId,
      ideaJobManager,
      job,
    })

    expect(db.select().from(debateJobs).get()).toMatchObject({
      stage: "final",
      status: "completed",
      error: null,
    })
    expect(mocks.generateObjectStream).toHaveBeenCalledTimes(
      getTotalMatchCount(DEBATE_TOURNAMENT_FORMAT.minParticipantCount) + 1,
    )
    expect(mocks.generateObjectStream.mock.calls[0]?.[0]).not.toHaveProperty(
      "maxRetries",
    )
    expect(mocks.completeDebateMatch).toHaveBeenCalledTimes(
      getTotalMatchCount(DEBATE_TOURNAMENT_FORMAT.minParticipantCount),
    )
    const firstCompletedMatch = mocks.completeDebateMatch.mock.calls[0]?.[0] as {
      debateMatchId: string
      winnerIdeaId: string
    }
    const createdMatches = mocks.createDebateRound.mock.results.flatMap(
      ({ value }) =>
        value as Array<{
          debateMatchId: string
          firstIdeaId: string
          secondIdeaId: string
        }>,
    )
    const createdMatch = createdMatches.find(
      ({ debateMatchId }) =>
        debateMatchId === firstCompletedMatch.debateMatchId,
    )
    expect(firstCompletedMatch).toMatchObject({
      winnerIdeaId: createdMatch?.secondIdeaId,
      judgeGenerationId: "retry-judge-2",
    })
  })

  it("fails the debate when the winning idea website cannot be generated", async () => {
    let advocateGenerationNumber = 0
    mocks.generateTextStream.mockImplementation((input: {
      promptName?: string
      owner: { debateJobId?: string }
      onRegistered?: (
        id: string,
        transaction: { kind: string },
      ) => void
    }) => {
      if (input.promptName === PromptName.CreateIdeaSite) {
        return Promise.reject(new Error("Website generation failed"))
      }
      const id = `site-fail-agent-${(advocateGenerationNumber += 1)}`
      input.onRegistered?.(id, { kind: "registration-transaction" })
      return Promise.resolve({
        id,
        completion: Promise.resolve({
          status: "completed" as const,
          text: "Substantive argument",
          reasoning: "",
          finishReason: "stop" as const,
        }),
      })
    })
    const fixture = createRunFixture()
    // Point the briefing link at an unfinished generation after fixture
    // creation so the winner-site lookup fails.
    const runningSummaryId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: runningSummaryId,
        userId: "test-user-id",
        ideaJobId: fixture.ideaJobId,
        status: "running",
      })
      .run()
    db.update(ideaJobs)
      .set({ researchSummaryGenerationId: runningSummaryId })
      .where(eq(ideaJobs.ideaJobId, fixture.ideaJobId))
      .run()

    await runDebateJob({
      debateJobId: fixture.debateJobId,
      ideaJobManager: fixture.ideaJobManager,
      job: fixture.job,
    })

    expect(db.select().from(debateJobs).get()).toMatchObject({
      status: "failed",
      error: "Research summary generation of the debate idea job did not complete",
    })
    expect(db.select().from(debateJobs).get()).toMatchObject({
      websiteGenerationId: null,
    })
    expect(await fixture.events).toContainEqual({
      type: "error",
      message: "Research summary generation of the debate idea job did not complete",
    })
  })

  it("persists user Stop as interruption without an ordinary error event", async () => {
    const { debateJobId, ideaJobManager, job, events } = createRunFixture()
    db.update(debateJobs)
      .set({ cancelRequestedAt: new Date() })
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()
    const controller = new AbortController()
    controller.abort(workflowAbortReason("user-stop"))

    await runDebateJob({
      debateJobId,
      ideaJobManager,
      job,
      workflowSignal: controller.signal,
    })

    expect(db.select().from(debateJobs).get()).toMatchObject({
      status: "interrupted",
      error: "Workflow stopped by user",
    })
    expect(await events).toEqual([{ type: "updated" }, { type: "done" }])
    expect(mocks.createDebateRound).not.toHaveBeenCalled()
  })
})
