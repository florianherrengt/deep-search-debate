const minParticipantCount = 6
const maxParticipantCount = 100
const defaultParticipantCount = 12
const swissRounds = 5
const knockoutSize = 4
const semifinalMatchCount = knockoutSize / 2
const finalMatchCount = 1

export const DEBATE_TOURNAMENT_FORMAT = {
  minParticipantCount,
  maxParticipantCount,
  defaultParticipantCount,
  // Default-field projections retained for callers that render or fixture the
  // standard 12-idea format. Runtime tournaments derive these from admission.
  participantCount: defaultParticipantCount,
  swissRounds,
  matchesPerSwissRound: defaultParticipantCount / 2,
  initialElo: 1500,
  eloKFactor: 32,
  knockoutSize,
  semifinalMatchCount,
  finalMatchCount,
  totalMatchCount:
    swissRounds * (defaultParticipantCount / 2) +
    semifinalMatchCount +
    finalMatchCount,
} as const

export function getMatchesPerSwissRound(participantCount: number): number {
  if (!Number.isInteger(participantCount) || participantCount % 2 !== 0) {
    throw new Error("A Swiss tournament requires an even number of ideas")
  }
  return participantCount / 2
}

export function getTotalMatchCount(participantCount: number): number {
  return (
    DEBATE_TOURNAMENT_FORMAT.swissRounds *
      getMatchesPerSwissRound(participantCount) +
    DEBATE_TOURNAMENT_FORMAT.semifinalMatchCount +
    DEBATE_TOURNAMENT_FORMAT.finalMatchCount
  )
}

export type TournamentIdea = Readonly<{
  ideaId: string
  position: number
}>

export type DebatePairing = Readonly<{
  firstIdeaId: string
  secondIdeaId: string
}>

export type DebateMatchResult = DebatePairing &
  Readonly<{
    winnerIdeaId: string
  }>

export type SwissStanding = TournamentIdea &
  Readonly<{
    wins: number
    elo: number
  }>

export type CompletedSwissRound = readonly DebateMatchResult[]

type PairingScore = readonly [
  differentWinPairCount: number,
  totalWinGap: number,
  totalEloGap: number,
]

const UINT32_MAX = 0xffff_ffff

function assertRandomSeed(randomSeed: number): void {
  if (
    !Number.isInteger(randomSeed) ||
    randomSeed < 0 ||
    randomSeed > UINT32_MAX
  ) {
    throw new Error("Random seed must be an unsigned 32-bit integer")
  }
}

function assertIdeas(ideas: readonly TournamentIdea[]): void {
  if (
    ideas.length < DEBATE_TOURNAMENT_FORMAT.minParticipantCount ||
    ideas.length > DEBATE_TOURNAMENT_FORMAT.maxParticipantCount ||
    ideas.length % 2 !== 0
  ) {
    throw new Error(
      `A debate tournament requires an even number of ideas between ${DEBATE_TOURNAMENT_FORMAT.minParticipantCount} and ${DEBATE_TOURNAMENT_FORMAT.maxParticipantCount}`,
    )
  }

  const ideaIds = new Set<string>()
  const positions = new Set<number>()
  for (const idea of ideas) {
    if (idea.ideaId.length === 0) throw new Error("Idea IDs must not be empty")
    if (ideaIds.has(idea.ideaId)) throw new Error("Idea IDs must be unique")
    if (!Number.isInteger(idea.position) || idea.position < 0) {
      throw new Error("Idea positions must be non-negative integers")
    }
    if (positions.has(idea.position)) {
      throw new Error("Idea positions must be unique")
    }
    ideaIds.add(idea.ideaId)
    positions.add(idea.position)
  }
}

function assertStandings(standings: readonly SwissStanding[]): void {
  assertIdeas(standings)
  for (const standing of standings) {
    if (!Number.isInteger(standing.wins) || standing.wins < 0) {
      throw new Error("Swiss wins must be non-negative integers")
    }
    if (!Number.isFinite(standing.elo)) {
      throw new Error("Elo ratings must be finite")
    }
  }
}

function sortIdeasByPosition(
  ideas: readonly TournamentIdea[],
): TournamentIdea[] {
  return [...ideas].sort(
    (first, second) =>
      first.position - second.position ||
      first.ideaId.localeCompare(second.ideaId),
  )
}

/** Mulberry32 is small, stable across runtimes, and sufficient for pairings. */
function createRandom(randomSeed: number): () => number {
  let state = randomSeed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function deriveSeed(randomSeed: number, salt: number): number {
  return (randomSeed + Math.imul(salt, 0x9e3779b9)) >>> 0
}

function shuffle<T>(values: readonly T[], randomSeed: number): T[] {
  const shuffled = [...values]
  const random = createRandom(randomSeed)
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(random() * (index + 1))
    const value = shuffled[index]
    shuffled[index] = shuffled[otherIndex]
    shuffled[otherIndex] = value
  }
  return shuffled
}

function pairingKey(firstIdeaId: string, secondIdeaId: string): string {
  return JSON.stringify(
    firstIdeaId < secondIdeaId
      ? [firstIdeaId, secondIdeaId]
      : [secondIdeaId, firstIdeaId],
  )
}

function assertResult(result: DebateMatchResult): void {
  if (result.firstIdeaId === result.secondIdeaId) {
    throw new Error("An idea cannot debate itself")
  }
  if (
    result.winnerIdeaId !== result.firstIdeaId &&
    result.winnerIdeaId !== result.secondIdeaId
  ) {
    throw new Error("A match winner must be one of its opponents")
  }
}

function assertSwissRound(
  round: CompletedSwissRound,
  knownIdeaIds: ReadonlySet<string>,
  previousPairings: ReadonlySet<string>,
): void {
  const matchesPerRound = getMatchesPerSwissRound(knownIdeaIds.size)
  if (round.length !== matchesPerRound) {
    throw new Error(
      `A Swiss round requires exactly ${matchesPerRound} matches`,
    )
  }

  const appearances = new Set<string>()
  for (const result of round) {
    assertResult(result)
    if (
      !knownIdeaIds.has(result.firstIdeaId) ||
      !knownIdeaIds.has(result.secondIdeaId)
    ) {
      throw new Error("A Swiss match contains an idea outside the tournament")
    }
    if (
      appearances.has(result.firstIdeaId) ||
      appearances.has(result.secondIdeaId)
    ) {
      throw new Error("An idea cannot appear more than once in a Swiss round")
    }
    const key = pairingKey(result.firstIdeaId, result.secondIdeaId)
    if (previousPairings.has(key)) {
      throw new Error("Swiss opponents cannot debate more than once")
    }
    appearances.add(result.firstIdeaId)
    appearances.add(result.secondIdeaId)
  }
}

function getSeedOrder(
  ideas: readonly TournamentIdea[],
  randomSeed: number,
): ReadonlyMap<string, number> {
  return new Map(
    shuffle(sortIdeasByPosition(ideas), randomSeed).map((idea, index) => [
      idea.ideaId,
      index,
    ]),
  )
}

function compareBySeedOrder(
  first: TournamentIdea,
  second: TournamentIdea,
  seedOrder: ReadonlyMap<string, number>,
): number {
  return (
    (seedOrder.get(first.ideaId) as number) -
    (seedOrder.get(second.ideaId) as number)
  )
}

/**
 * Ranks completed Swiss play without storing a standings snapshot. Head-to-head
 * only breaks a primary tie containing exactly two ideas.
 */
export function rankSwissStandings(
  standings: readonly SwissStanding[],
  completedMatches: readonly DebateMatchResult[],
  randomSeed: number,
): SwissStanding[] {
  assertRandomSeed(randomSeed)
  assertStandings(standings)
  const knownIdeaIds = new Set(standings.map(({ ideaId }) => ideaId))
  for (const match of completedMatches) {
    assertResult(match)
    if (
      !knownIdeaIds.has(match.firstIdeaId) ||
      !knownIdeaIds.has(match.secondIdeaId)
    ) {
      throw new Error("A ranking match contains an idea outside the tournament")
    }
  }

  const seedOrder = getSeedOrder(standings, randomSeed)
  const primaryOrder = [...standings].sort(
    (first, second) =>
      second.wins - first.wins ||
      second.elo - first.elo ||
      compareBySeedOrder(first, second, seedOrder),
  )
  const ranked: SwissStanding[] = []

  for (let start = 0; start < primaryOrder.length; ) {
    const first = primaryOrder[start]
    let end = start + 1
    while (
      end < primaryOrder.length &&
      primaryOrder[end]?.wins === first.wins &&
      primaryOrder[end]?.elo === first.elo
    ) {
      end += 1
    }

    const tied = primaryOrder.slice(start, end)
    if (tied.length === 2) {
      const [left, right] = tied as [SwissStanding, SwissStanding]
      const headToHead = completedMatches.find(
        (match) =>
          pairingKey(match.firstIdeaId, match.secondIdeaId) ===
          pairingKey(left.ideaId, right.ideaId),
      )
      if (headToHead?.winnerIdeaId === right.ideaId) tied.reverse()
    }
    ranked.push(...tied)
    start = end
  }

  return ranked
}

function expectedScore(elo: number, opponentElo: number): number {
  return 1 / (1 + 10 ** ((opponentElo - elo) / 400))
}

/** Rebuilds wins and Elo round-by-round from durable match results. */
export function deriveSwissStandings(
  ideas: readonly TournamentIdea[],
  completedRounds: readonly CompletedSwissRound[],
  randomSeed: number,
): SwissStanding[] {
  assertRandomSeed(randomSeed)
  assertIdeas(ideas)
  if (completedRounds.length > DEBATE_TOURNAMENT_FORMAT.swissRounds) {
    throw new Error(
      `Swiss play cannot exceed ${DEBATE_TOURNAMENT_FORMAT.swissRounds} rounds`,
    )
  }

  const knownIdeaIds = new Set(ideas.map(({ ideaId }) => ideaId))
  const previousPairings = new Set<string>()
  const allMatches: DebateMatchResult[] = []
  const standings = new Map<string, SwissStanding>(
    ideas.map((idea) => [
      idea.ideaId,
      {
        ...idea,
        wins: 0,
        elo: DEBATE_TOURNAMENT_FORMAT.initialElo,
      },
    ]),
  )

  for (const round of completedRounds) {
    assertSwissRound(round, knownIdeaIds, previousPairings)
    const roundStartRatings = new Map(
      [...standings].map(([ideaId, standing]) => [ideaId, standing.elo]),
    )
    const ratingChanges = new Map<string, number>()

    for (const match of round) {
      const firstElo = roundStartRatings.get(match.firstIdeaId) as number
      const secondElo = roundStartRatings.get(match.secondIdeaId) as number
      const firstWon = match.winnerIdeaId === match.firstIdeaId
      const firstChange =
        DEBATE_TOURNAMENT_FORMAT.eloKFactor *
        ((firstWon ? 1 : 0) - expectedScore(firstElo, secondElo))
      ratingChanges.set(match.firstIdeaId, firstChange)
      ratingChanges.set(match.secondIdeaId, -firstChange)

      const winner = standings.get(match.winnerIdeaId) as SwissStanding
      standings.set(match.winnerIdeaId, { ...winner, wins: winner.wins + 1 })
      previousPairings.add(pairingKey(match.firstIdeaId, match.secondIdeaId))
      allMatches.push(match)
    }

    for (const [ideaId, change] of ratingChanges) {
      const standing = standings.get(ideaId) as SwissStanding
      standings.set(ideaId, {
        ...standing,
        elo: (roundStartRatings.get(ideaId) as number) + change,
      })
    }
  }

  return rankSwissStandings([...standings.values()], allMatches, randomSeed)
}

function compareScore(first: PairingScore, second: PairingScore): number {
  for (let index = 0; index < first.length; index += 1) {
    const difference = first[index] - second[index]
    if (difference !== 0) return difference
  }
  return 0
}

function addPairingScore(
  score: PairingScore,
  first: SwissStanding,
  second: SwissStanding,
): PairingScore {
  const winGap = Math.abs(first.wins - second.wins)
  return [
    score[0] + (winGap === 0 ? 0 : 1),
    score[1] + winGap,
    score[2] + Math.abs(first.elo - second.elo),
  ]
}

/**
 * Finds the first valid perfect matching after ordering each opponent choice by
 * Swiss-score proximity. Backtracking avoids greedy no-repeat dead ends without
 * exhaustively scoring every matching, which is intractable for large fields.
 */
function findBestSwissPairing(
  orderedStandings: readonly SwissStanding[],
  previousPairings: ReadonlySet<string>,
): DebatePairing[] {
  function visit(
    remaining: readonly SwissStanding[],
  ): DebatePairing[] | undefined {
    if (remaining.length === 0) return []

    const first = remaining[0]
    const opponents = remaining
      .slice(1)
      .filter(
        (second) =>
          !previousPairings.has(pairingKey(first.ideaId, second.ideaId)),
      )
      .sort((left, right) =>
        compareScore(
          addPairingScore([0, 0, 0], first, left),
          addPairingScore([0, 0, 0], first, right),
        ) || left.ideaId.localeCompare(right.ideaId),
      )

    for (const second of opponents) {
      const nextRemaining = remaining.filter(
        (candidate) =>
          candidate.ideaId !== first.ideaId &&
          candidate.ideaId !== second.ideaId,
      )
      const remainder = visit(nextRemaining)
      if (remainder) {
        return [
          { firstIdeaId: first.ideaId, secondIdeaId: second.ideaId },
          ...remainder,
        ]
      }
    }
    return undefined
  }

  const pairings = visit(orderedStandings)
  if (!pairings) {
    throw new Error("No valid non-repeating Swiss pairing exists")
  }
  return pairings
}

function randomizePresentation(
  pairings: readonly DebatePairing[],
  randomSeed: number,
): DebatePairing[] {
  const random = createRandom(randomSeed)
  return pairings.map((pairing) =>
    random() < 0.5
      ? pairing
      : {
          firstIdeaId: pairing.secondIdeaId,
          secondIdeaId: pairing.firstIdeaId,
        },
  )
}

/** Creates the next complete Swiss round, including deterministic slot order. */
export function createNextSwissRound(input: {
  ideas: readonly TournamentIdea[]
  completedRounds: readonly CompletedSwissRound[]
  randomSeed: number
}): DebatePairing[] {
  const { ideas, completedRounds, randomSeed } = input
  assertRandomSeed(randomSeed)
  assertIdeas(ideas)
  if (completedRounds.length >= DEBATE_TOURNAMENT_FORMAT.swissRounds) {
    throw new Error("All Swiss rounds are already complete")
  }

  if (completedRounds.length === 0) {
    const shuffled = shuffle(sortIdeasByPosition(ideas), randomSeed)
    return Array.from(
      { length: getMatchesPerSwissRound(ideas.length) },
      (_, index) => ({
        firstIdeaId: shuffled[index * 2].ideaId,
        secondIdeaId: shuffled[index * 2 + 1].ideaId,
      }),
    )
  }

  const standings = deriveSwissStandings(ideas, completedRounds, randomSeed)
  const previousPairings = new Set(
    completedRounds
      .flat()
      .map((match) => pairingKey(match.firstIdeaId, match.secondIdeaId)),
  )
  const seedOrder = getSeedOrder(
    standings,
    deriveSeed(randomSeed, completedRounds.length + 1),
  )
  const orderedStandings = [...standings].sort(
    (first, second) =>
      second.wins - first.wins ||
      second.elo - first.elo ||
      compareBySeedOrder(first, second, seedOrder),
  )
  const pairings = findBestSwissPairing(orderedStandings, previousPairings)
  return randomizePresentation(
    pairings,
    deriveSeed(randomSeed, 10 + completedRounds.length),
  )
}

/** Creates bracket positions 1-v-4 and 2-v-3, with randomized judge slots. */
export function createSemifinalRound(
  rankedStandings: readonly SwissStanding[],
  randomSeed: number,
): DebatePairing[] {
  assertRandomSeed(randomSeed)
  assertStandings(rankedStandings)
  const logicalPairings = [
    {
      firstIdeaId: rankedStandings[0].ideaId,
      secondIdeaId: rankedStandings[3].ideaId,
    },
    {
      firstIdeaId: rankedStandings[1].ideaId,
      secondIdeaId: rankedStandings[2].ideaId,
    },
  ]
  return randomizePresentation(logicalPairings, deriveSeed(randomSeed, 101))
}

/** Creates the final from the two semifinal winners. */
export function createFinalRound(
  semifinalResults: readonly DebateMatchResult[],
  randomSeed: number,
): DebatePairing {
  assertRandomSeed(randomSeed)
  if (semifinalResults.length !== 2) {
    throw new Error("The final requires exactly two completed semifinals")
  }
  for (const result of semifinalResults) assertResult(result)
  const [firstSemifinal, secondSemifinal] = semifinalResults
  if (firstSemifinal.winnerIdeaId === secondSemifinal.winnerIdeaId) {
    throw new Error("The semifinal winners must be distinct")
  }
  return randomizePresentation(
    [
      {
        firstIdeaId: firstSemifinal.winnerIdeaId,
        secondIdeaId: secondSemifinal.winnerIdeaId,
      },
    ],
    deriveSeed(randomSeed, 102),
  )[0]
}
