import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../../db/index.ts"
import {
  debateJobs,
  debateMatches,
  debateRounds,
  ideaJobs,
  ideas,
} from "../../db/schema/index.ts"
import {
  createDebateRound,
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
    }),
  )

  db.insert(ideaJobs)
    .values({
      ideaJobId,
      prompt: "Choose a product",
      numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
      deepSearchCount: 2,
    })
    .run()
  db.insert(ideas).values(ideaRows).run()
  db.insert(debateJobs)
    .values({ debateJobId, ideaJobId, randomSeed: 42, stage })
    .run()

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
    db.delete(ideaJobs).run()
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
    ).toThrow("Every match idea must belong to the debate's idea job")
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
})
