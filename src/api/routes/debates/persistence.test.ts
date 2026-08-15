import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../../db/index.ts"
import {
  debateJobs,
  debateMatches,
  debateMessages,
  debateRounds,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import {
  createAgentMessage,
  createDebateRound,
  replaceFailedAgentMessageGeneration,
  type DebateRoundStage,
  type IdeaPair,
} from "./persistence.ts"
import { DEBATE_TOURNAMENT_FORMAT } from "./tournament.ts"

type Fixture = {
  debateJobId: string
  ideaIds: string[]
}

function createFixture(stage: DebateRoundStage = "swiss"): Fixture {
  const ideaJobId = crypto.randomUUID()
  const debateJobId = crypto.randomUUID()
  const ideaRows = Array.from(
    { length: DEBATE_TOURNAMENT_FORMAT.participantCount },
    (_, position) => ({
      ideaId: crypto.randomUUID(),
      ideaJobId,
      position,
      title: `Idea ${position + 1}`,
      description: `Description ${position + 1}`,
      evaluationGenerationId: crypto.randomUUID(),
      selected: true,
    }),
  )

  db.insert(debateJobs)
    .values({
      debateJobId,
      userId: "test-user-id",
      randomSeed: 42,
      stage,
    })
    .run()
  db.insert(ideaJobs)
    .values({
      userId: "test-user-id",
      ideaJobId,
      debateJobId,
      slug: `ideas-${ideaJobId}`,
      prompt: "Choose a product",
      numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
      deepSearchCount: 2,
    })
    .run()
  db.insert(llmGenerations)
    .values(
      ideaRows.map(({ evaluationGenerationId }) => ({
        llmGenerationId: evaluationGenerationId,
        userId: "test-user-id",
        ideaJobId,
      })),
    )
    .run()
  db.insert(ideas).values(ideaRows).run()

  return { debateJobId, ideaIds: ideaRows.map(({ ideaId }) => ideaId) }
}

function sequentialPairs(ideaIds: readonly string[]): IdeaPair[] {
  return Array.from(
    { length: ideaIds.length / 2 },
    (_, index) => [ideaIds[index * 2], ideaIds[index * 2 + 1]] as const,
  )
}

describe("debate round persistence", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
  })

  it("rejects an idea owned by another idea job", () => {
    const fixture = createFixture()
    const outsider = createFixture().ideaIds[0]
    const pairs = sequentialPairs(fixture.ideaIds)
    pairs[pairs.length - 1] = [
      pairs[pairs.length - 1][0],
      outsider,
    ]

    expect(() =>
      createDebateRound({
        debateJobId: fixture.debateJobId,
        stage: "swiss",
        stageRoundNumber: 1,
        pairs,
      }),
    ).toThrow("Every match idea must be selected for this debate")
  })

  it("rejects duplicate appearances and incorrect stage match counts", () => {
    const fixture = createFixture()
    const pairs = sequentialPairs(fixture.ideaIds)
    pairs[1] = [pairs[0][0], pairs[1][1]]

    expect(() =>
      createDebateRound({
        debateJobId: fixture.debateJobId,
        stage: "swiss",
        stageRoundNumber: 1,
        pairs,
      }),
    ).toThrow("An idea cannot appear more than once in a round")

    expect(() =>
      createDebateRound({
        debateJobId: fixture.debateJobId,
        stage: "swiss",
        stageRoundNumber: 1,
        pairs: sequentialPairs(fixture.ideaIds).slice(1),
      }),
    ).toThrow("Incorrect number of swiss matches")

    const semifinal = createFixture("semifinal")
    expect(() =>
      createDebateRound({
        debateJobId: semifinal.debateJobId,
        stage: "semifinal",
        stageRoundNumber: 1,
        pairs: [[semifinal.ideaIds[0], semifinal.ideaIds[1]]],
      }),
    ).toThrow("Incorrect number of semifinal matches")
  })

  it("requires completed prior rounds and rejects repeated Swiss opponents", () => {
    const missingPriorRound = createFixture()
    expect(() =>
      createDebateRound({
        debateJobId: missingPriorRound.debateJobId,
        stage: "swiss",
        stageRoundNumber: 2,
        pairs: sequentialPairs(missingPriorRound.ideaIds),
      }),
    ).toThrow("The previous Swiss round is incomplete")

    const fixture = createFixture()
    const firstRound = createDebateRound({
      debateJobId: fixture.debateJobId,
      stage: "swiss",
      stageRoundNumber: 1,
      pairs: sequentialPairs(fixture.ideaIds),
    })
    const completedAt = new Date()
    for (const match of firstRound) {
      db.update(debateMatches)
        .set({ winnerIdeaId: match.firstIdeaId, completedAt })
        .where(eq(debateMatches.debateMatchId, match.debateMatchId))
        .run()
    }

    const repeatedPairs: IdeaPair[] = [
      [fixture.ideaIds[0], fixture.ideaIds[1]],
      [fixture.ideaIds[2], fixture.ideaIds[4]],
      [fixture.ideaIds[3], fixture.ideaIds[5]],
      [fixture.ideaIds[6], fixture.ideaIds[8]],
      [fixture.ideaIds[7], fixture.ideaIds[10]],
      [fixture.ideaIds[9], fixture.ideaIds[11]],
    ]
    expect(() =>
      createDebateRound({
        debateJobId: fixture.debateJobId,
        stage: "swiss",
        stageRoundNumber: 2,
        pairs: repeatedPairs,
      }),
    ).toThrow("Swiss matchups cannot repeat")
  })

  it("does not allow knockout rounds before Swiss play completes", () => {
    const fixture = createFixture("semifinal")

    expect(() =>
      createDebateRound({
        debateJobId: fixture.debateJobId,
        stage: "semifinal",
        stageRoundNumber: 1,
        pairs: [
          [fixture.ideaIds[0], fixture.ideaIds[3]],
          [fixture.ideaIds[1], fixture.ideaIds[2]],
        ],
      }),
    ).toThrow(
      `All ${DEBATE_TOURNAMENT_FORMAT.swissRounds} Swiss rounds must complete before knockout`,
    )
    expect(
      db
        .select()
        .from(debateRounds)
        .where(eq(debateRounds.debateJobId, fixture.debateJobId))
        .all(),
    ).toEqual([])
  })

  it("rejects new rounds and messages after the debate root requests Stop", () => {
    const fixture = createFixture()
    const [match] = createDebateRound({
      debateJobId: fixture.debateJobId,
      stage: "swiss",
      stageRoundNumber: 1,
      pairs: sequentialPairs(fixture.ideaIds),
    })
    const llmGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({
        llmGenerationId,
        userId: "test-user-id",
        debateJobId: fixture.debateJobId,
      })
      .run()
    db.update(debateJobs)
      .set({ cancelRequestedAt: new Date() })
      .where(eq(debateJobs.debateJobId, fixture.debateJobId))
      .run()

    expect(() =>
      createDebateRound({
        debateJobId: fixture.debateJobId,
        stage: "swiss",
        stageRoundNumber: 2,
        pairs: sequentialPairs(fixture.ideaIds),
      }),
    ).toThrow("Effective research root is stop-requested")
    expect(() =>
      db.transaction((transaction) =>
        createAgentMessage(
          {
            debateMatchId: match.debateMatchId,
            position: 0,
            speakerSlot: 0,
            llmGenerationId,
          },
          transaction,
        ),
      ),
    ).toThrow("Effective research root is stop-requested")
  })

  it("rejects a transcript generation owned by another debate", () => {
    const fixture = createFixture()
    const [match] = createDebateRound({
      debateJobId: fixture.debateJobId,
      stage: "swiss",
      stageRoundNumber: 1,
      pairs: sequentialPairs(fixture.ideaIds),
    })
    const foreignDebateJobId = createFixture().debateJobId
    const llmGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({
        llmGenerationId,
        userId: "test-user-id",
        debateJobId: foreignDebateJobId,
      })
      .run()

    expect(() =>
      db.transaction((transaction) =>
        createAgentMessage(
          {
            debateMatchId: match.debateMatchId,
            position: 0,
            speakerSlot: 0,
            llmGenerationId,
          },
          transaction,
        ),
      ),
    ).toThrow("LLM generation must belong to the debate job owner")
    expect(
      db
        .select()
        .from(debateMessages)
        .where(eq(debateMessages.debateMatchId, match.debateMatchId))
        .all(),
    ).toEqual([])
  })

  it("replaces a transcript generation link for a bounded retry", () => {
    const fixture = createFixture()
    const [match] = createDebateRound({
      debateJobId: fixture.debateJobId,
      stage: "swiss",
      stageRoundNumber: 1,
      pairs: sequentialPairs(fixture.ideaIds),
    })
    const firstGenerationId = crypto.randomUUID()
    const retryGenerationId = crypto.randomUUID()
    const staleRetryGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values(
        [
          firstGenerationId,
          retryGenerationId,
          staleRetryGenerationId,
        ].map((llmGenerationId) => ({
            llmGenerationId,
            userId: "test-user-id",
            debateJobId: fixture.debateJobId,
          })),
      )
      .run()

    db.transaction((transaction) =>
      createAgentMessage(
        {
          debateMatchId: match.debateMatchId,
          position: 0,
          speakerSlot: 0,
          llmGenerationId: firstGenerationId,
        },
        transaction,
      ),
    )
    expect(() =>
      db.transaction((transaction) =>
        createAgentMessage(
          {
            debateMatchId: match.debateMatchId,
            position: 0,
            speakerSlot: 0,
            llmGenerationId: retryGenerationId,
          },
          transaction,
        ),
      ),
    ).toThrow("UNIQUE constraint failed")
    db.update(llmGenerations)
      .set({
        status: "failed",
        text: "Partial opening:",
        reasoning: "",
        error: 'Text generation ended with finish reason "other"',
        finishReason: "other",
        completedAt: new Date(),
      })
      .where(eq(llmGenerations.llmGenerationId, firstGenerationId))
      .run()
    db.transaction((transaction) =>
      replaceFailedAgentMessageGeneration(
        {
          debateMatchId: match.debateMatchId,
          position: 0,
          failedGenerationId: firstGenerationId,
          retryGenerationId,
        },
        transaction,
      ),
    )

    expect(
      db
        .select({
          position: debateMessages.position,
          speakerSlot: debateMessages.speakerSlot,
          llmGenerationId: debateMessages.llmGenerationId,
        })
        .from(debateMessages)
        .where(eq(debateMessages.debateMatchId, match.debateMatchId))
        .all(),
    ).toEqual([
      {
        position: 0,
        speakerSlot: 0,
        llmGenerationId: retryGenerationId,
      },
    ])

    expect(() =>
      db.transaction((transaction) =>
        replaceFailedAgentMessageGeneration(
          {
            debateMatchId: match.debateMatchId,
            position: 0,
            failedGenerationId: firstGenerationId,
            retryGenerationId: staleRetryGenerationId,
          },
          transaction,
        ),
      ),
    ).toThrow("The failed debate message generation link changed")

    db.update(llmGenerations)
      .set({
        status: "completed",
        text: "Completed retry",
        reasoning: "",
        finishReason: "stop",
        completedAt: new Date(),
      })
      .where(eq(llmGenerations.llmGenerationId, retryGenerationId))
      .run()
    expect(() =>
      db.transaction((transaction) =>
        replaceFailedAgentMessageGeneration(
          {
            debateMatchId: match.debateMatchId,
            position: 0,
            failedGenerationId: retryGenerationId,
            retryGenerationId: staleRetryGenerationId,
          },
          transaction,
        ),
      ),
    ).toThrow("The replaced generation is not a failed other finish")

    const foreignDebateJobId = createFixture().debateJobId
    const foreignGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: foreignGenerationId,
        userId: "test-user-id",
        debateJobId: foreignDebateJobId,
      })
      .run()
    expect(() =>
      db.transaction((transaction) =>
        replaceFailedAgentMessageGeneration(
          {
            debateMatchId: match.debateMatchId,
            position: 0,
            failedGenerationId: firstGenerationId,
            retryGenerationId: foreignGenerationId,
          },
          transaction,
        ),
      ),
    ).toThrow("LLM generation must belong to the debate job owner")
  })
})
