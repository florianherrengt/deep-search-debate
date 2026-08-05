import { describe, expect, it } from "vitest"

import {
  createFinalRound,
  createNextSwissRound,
  createSemifinalRound,
  DEBATE_TOURNAMENT_FORMAT,
  deriveSwissStandings,
  rankSwissStandings,
  type CompletedSwissRound,
  type DebateMatchResult,
  type DebatePairing,
  type SwissStanding,
  type TournamentIdea,
} from "./tournament.ts"

const ideas: TournamentIdea[] = Array.from(
  { length: DEBATE_TOURNAMENT_FORMAT.participantCount },
  (_, position) => ({
    ideaId: `idea-${position}`,
    position,
  }),
)

function complete(
  pairings: readonly DebatePairing[],
  winner: (pairing: DebatePairing, index: number) => string = (pairing) =>
    pairing.firstIdeaId,
): CompletedSwissRound {
  return pairings.map((pairing, index) => ({
    ...pairing,
    winnerIdeaId: winner(pairing, index),
  }))
}

function key(pairing: DebatePairing): string {
  return [pairing.firstIdeaId, pairing.secondIdeaId].sort().join(":")
}

function standing(
  idea: TournamentIdea,
  wins: number,
  elo: number,
): SwissStanding {
  return { ...idea, wins, elo }
}

describe("debate tournament format", () => {
  it("keeps the fixed 12-player, five-round Elo configuration explicit", () => {
    expect(DEBATE_TOURNAMENT_FORMAT).toEqual({
      participantCount: 12,
      swissRounds: 5,
      matchesPerSwissRound: 6,
      initialElo: 1500,
      eloKFactor: 32,
      knockoutSize: 4,
      semifinalMatchCount: 2,
      finalMatchCount: 1,
      totalMatchCount: 33,
    })
  })
})

describe("Swiss pairing", () => {
  it("creates a seeded first round reproducibly and independently of input order", () => {
    const first = createNextSwissRound({
      ideas,
      completedRounds: [],
      randomSeed: 1_234_567,
    })
    const repeated = createNextSwissRound({
      ideas: [...ideas].reverse(),
      completedRounds: [],
      randomSeed: 1_234_567,
    })
    const anotherSeed = createNextSwissRound({
      ideas,
      completedRounds: [],
      randomSeed: 7_654_321,
    })

    expect(first).toEqual(repeated)
    expect(first).not.toEqual(anotherSeed)
    expect(first).toHaveLength(DEBATE_TOURNAMENT_FORMAT.matchesPerSwissRound)
    expect(
      new Set(first.flatMap(({ firstIdeaId, secondIdeaId }) => [
        firstIdeaId,
        secondIdeaId,
      ])),
    ).toEqual(new Set(ideas.map(({ ideaId }) => ideaId)))
  })

  it("keeps round-two opponents in equal-win groups when that is possible", () => {
    const firstPairings = createNextSwissRound({
      ideas,
      completedRounds: [],
      randomSeed: 42,
    })
    const firstRound = complete(firstPairings)
    const standings = deriveSwissStandings(ideas, [firstRound], 42)
    const wins = new Map(standings.map((entry) => [entry.ideaId, entry.wins]))
    const secondPairings = createNextSwissRound({
      ideas,
      completedRounds: [firstRound],
      randomSeed: 42,
    })

    expect(secondPairings).toHaveLength(
      DEBATE_TOURNAMENT_FORMAT.matchesPerSwissRound,
    )
    expect(secondPairings.every((pairing) => wins.get(pairing.firstIdeaId) === wins.get(pairing.secondIdeaId))).toBe(true)
    expect(
      secondPairings.every(
        (pairing) => !new Set(firstPairings.map(key)).has(key(pairing)),
      ),
    ).toBe(true)
  })

  it("builds all 30 Swiss matches without repeats or double appearances", () => {
    const completedRounds: CompletedSwissRound[] = []
    const previousPairings = new Set<string>()

    for (
      let roundNumber = 0;
      roundNumber < DEBATE_TOURNAMENT_FORMAT.swissRounds;
      roundNumber += 1
    ) {
      const pairings = createNextSwissRound({
        ideas,
        completedRounds,
        randomSeed: 3_141_592,
      })
      const appearances = pairings.flatMap(
        ({ firstIdeaId, secondIdeaId }) => [firstIdeaId, secondIdeaId],
      )

      expect(pairings).toHaveLength(
        DEBATE_TOURNAMENT_FORMAT.matchesPerSwissRound,
      )
      expect(new Set(appearances)).toHaveLength(
        DEBATE_TOURNAMENT_FORMAT.participantCount,
      )
      for (const pairing of pairings) {
        expect(previousPairings.has(key(pairing))).toBe(false)
        previousPairings.add(key(pairing))
      }

      completedRounds.push(
        complete(pairings, (pairing, matchIndex) =>
          (roundNumber + matchIndex) % 3 === 0
            ? pairing.secondIdeaId
            : pairing.firstIdeaId,
        ),
      )
    }

    expect(previousPairings).toHaveLength(
      DEBATE_TOURNAMENT_FORMAT.swissRounds *
        DEBATE_TOURNAMENT_FORMAT.matchesPerSwissRound,
    )
    expect(() =>
      createNextSwissRound({
        ideas,
        completedRounds,
        randomSeed: 3_141_592,
      }),
    ).toThrow("All Swiss rounds are already complete")
  })

  it("rejects malformed membership, rounds, winners, and repeat opponents", () => {
    expect(() =>
      createNextSwissRound({
        ideas: ideas.slice(0, DEBATE_TOURNAMENT_FORMAT.participantCount - 1),
        completedRounds: [],
        randomSeed: 0,
      }),
    ).toThrow("exactly 12 ideas")
    expect(() =>
      createNextSwissRound({
        ideas: [
          ...ideas.slice(0, DEBATE_TOURNAMENT_FORMAT.participantCount - 1),
          {
            ...ideas[0],
            position: DEBATE_TOURNAMENT_FORMAT.participantCount - 1,
          },
        ],
        completedRounds: [],
        randomSeed: 0,
      }),
    ).toThrow("Idea IDs must be unique")
    expect(() =>
      createNextSwissRound({
        ideas,
        completedRounds: [],
        randomSeed: -1,
      }),
    ).toThrow("unsigned 32-bit integer")

    const pairings = createNextSwissRound({
      ideas,
      completedRounds: [],
      randomSeed: 99,
    })
    const validRound = complete(pairings)
    expect(() =>
      deriveSwissStandings(
        ideas,
        [
          validRound.slice(
            0,
            DEBATE_TOURNAMENT_FORMAT.matchesPerSwissRound - 1,
          ),
        ],
        99,
      ),
    ).toThrow(
      `exactly ${DEBATE_TOURNAMENT_FORMAT.matchesPerSwissRound} matches`,
    )
    expect(() =>
      deriveSwissStandings(
        ideas,
        [
          validRound.map((result, index) =>
            index === 1
              ? {
                  ...result,
                  firstIdeaId: validRound[0].firstIdeaId,
                  winnerIdeaId: validRound[0].firstIdeaId,
                }
              : result,
          ),
        ],
        99,
      ),
    ).toThrow("more than once")
    expect(() =>
      deriveSwissStandings(
        ideas,
        [
          validRound.map((result, index) =>
            index === 0 ? { ...result, winnerIdeaId: "outsider" } : result,
          ),
        ],
        99,
      ),
    ).toThrow("winner must be one")
    expect(() => deriveSwissStandings(ideas, [validRound, validRound], 99)).toThrow(
      "cannot debate more than once",
    )
  })
})

describe("Swiss standings", () => {
  it("calculates wins and K-32 Elo from ratings at the start of each round", () => {
    const firstRound = complete(
      [
        [0, 1],
        [2, 3],
        [4, 5],
        [6, 7],
        [8, 9],
        [10, 11],
      ].map(([first, second]) => ({
        firstIdeaId: `idea-${first}`,
        secondIdeaId: `idea-${second}`,
      })),
    )
    const afterFirst = deriveSwissStandings(ideas, [firstRound], 7)
    const firstRatings = new Map(afterFirst.map((entry) => [entry.ideaId, entry]))

    expect(firstRatings.get("idea-0")).toMatchObject({ wins: 1, elo: 1516 })
    expect(firstRatings.get("idea-1")).toMatchObject({ wins: 0, elo: 1484 })

    const secondRound = complete(
      [
        [0, 3],
        [2, 5],
        [4, 7],
        [6, 9],
        [8, 11],
        [10, 1],
      ].map(([first, second]) => ({
        firstIdeaId: `idea-${first}`,
        secondIdeaId: `idea-${second}`,
      })),
      (pairing) => pairing.secondIdeaId,
    )
    const afterSecond = deriveSwissStandings(
      ideas,
      [firstRound, secondRound],
      7,
    )
    const secondRatings = new Map(
      afterSecond.map((entry) => [entry.ideaId, entry]),
    )
    const expectedHigherRatedChange =
      32 * (0 - 1 / (1 + 10 ** ((1484 - 1516) / 400)))

    expect(secondRatings.get("idea-0")?.wins).toBe(1)
    expect(secondRatings.get("idea-3")?.wins).toBe(1)
    expect(secondRatings.get("idea-0")?.elo).toBeCloseTo(
      1516 + expectedHigherRatedChange,
    )
    expect(secondRatings.get("idea-3")?.elo).toBeCloseTo(
      1484 - expectedHigherRatedChange,
    )
    expect(
      afterSecond.reduce((total, entry) => total + entry.elo, 0),
    ).toBeCloseTo(
      DEBATE_TOURNAMENT_FORMAT.participantCount *
        DEBATE_TOURNAMENT_FORMAT.initialElo,
    )
  })

  it("ranks by wins, Elo, two-way head-to-head, then seeded order", () => {
    const primaryTie = ideas.map((idea, index) =>
      index < 2
        ? standing(idea, 4, 1_600)
        : standing(idea, 3, 1_590 - index),
    )
    const headToHead: DebateMatchResult = {
      firstIdeaId: "idea-0",
      secondIdeaId: "idea-1",
      winnerIdeaId: "idea-1",
    }
    expect(
      rankSwissStandings(primaryTie, [headToHead], 123)
        .slice(0, 2)
        .map(({ ideaId }) => ideaId),
    ).toEqual(["idea-1", "idea-0"])

    const threeWayTie = ideas.map((idea, index) =>
      index < 3
        ? standing(idea, 4, 1_600)
        : standing(idea, 3, 1_590 - index),
    )
    const seeded = rankSwissStandings(threeWayTie, [], 123)
    const headToHeadIgnored = rankSwissStandings(
      [...threeWayTie].reverse(),
      [headToHead],
      123,
    )
    expect(headToHeadIgnored.map(({ ideaId }) => ideaId)).toEqual(
      seeded.map(({ ideaId }) => ideaId),
    )
  })
})

describe("knockout pairing", () => {
  const ranked = ideas.map((idea, index) =>
    standing(
      idea,
      DEBATE_TOURNAMENT_FORMAT.participantCount - index,
      1_700 - index,
    ),
  )

  it("seeds first versus fourth and second versus third without exposing slot order", () => {
    const semifinals = createSemifinalRound(ranked, 5)

    expect(semifinals.map(key)).toEqual(["idea-0:idea-3", "idea-1:idea-2"])
    expect(createSemifinalRound(ranked, 5)).toEqual(semifinals)
  })

  it("creates the final from exactly two distinct semifinal winners", () => {
    const semifinalResults: DebateMatchResult[] = [
      {
        firstIdeaId: "idea-0",
        secondIdeaId: "idea-3",
        winnerIdeaId: "idea-3",
      },
      {
        firstIdeaId: "idea-1",
        secondIdeaId: "idea-2",
        winnerIdeaId: "idea-1",
      },
    ]
    expect(key(createFinalRound(semifinalResults, 5))).toBe("idea-1:idea-3")
    expect(() => createFinalRound(semifinalResults.slice(0, 1), 5)).toThrow(
      "exactly two",
    )
    expect(() =>
      createFinalRound(
        [
          semifinalResults[0],
          {
            firstIdeaId: "idea-3",
            secondIdeaId: "idea-2",
            winnerIdeaId: "idea-3",
          },
        ],
        5,
      ),
    ).toThrow("must be distinct")
  })
})
