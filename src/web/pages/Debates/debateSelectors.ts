import type {
  DebateIdea,
  DebateMatch,
  DebateRound,
  DebateTournament,
} from "./debateUiTypes.ts"

function getMatches(tournament: DebateTournament): DebateMatch[] {
  return tournament.rounds.flatMap((round) => round.matches)
}

export function getCompletedMatchCount(tournament: DebateTournament): number {
  return getMatches(tournament).filter((match) => match.status === "completed")
    .length
}

export function getSwissRounds(tournament: DebateTournament): DebateRound[] {
  return tournament.rounds
    .filter((round) => round.stage === "swiss")
    .toSorted(
      (first, second) => first.stageRoundNumber - second.stageRoundNumber,
    )
}

export function getCurrentSwissRound(
  tournament: DebateTournament,
): DebateRound | undefined {
  return getSwissRounds(tournament).at(-1)
}

export function getSemifinalRound(
  tournament: DebateTournament,
): DebateRound | undefined {
  return tournament.rounds.find((round) => round.stage === "semifinal")
}

export function getFinalMatch(
  tournament: DebateTournament,
): DebateMatch | undefined {
  return tournament.rounds.find((round) => round.stage === "final")?.matches[0]
}

export function getWinner(
  tournament: DebateTournament,
): DebateIdea | undefined {
  const finalMatch = getFinalMatch(tournament)
  if (!finalMatch?.winnerIdeaId) return undefined
  return finalMatch.firstIdea.ideaId === finalMatch.winnerIdeaId
    ? finalMatch.firstIdea
    : finalMatch.secondIdea
}

export function getSelectedMatch(
  tournament: DebateTournament,
  selectedMatchId: string | null | undefined,
): DebateMatch | undefined {
  const matches = getMatches(tournament)
  return (
    matches.find((match) => match.debateMatchId === selectedMatchId) ??
    matches.find((match) => match.status === "running") ??
    matches.toReversed().find((match) => match.status === "completed") ??
    matches[0]
  )
}
