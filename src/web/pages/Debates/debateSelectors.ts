import type {
  DebateIdea,
  DebateMatch,
  DebateRound,
  DebateTournament,
} from "./debateUiTypes.ts"

function getMatches(tournament: DebateTournament): DebateMatch[] {
  return tournament.rounds.flatMap((round) => round.matches)
}

export function getMatch(
  tournament: DebateTournament,
  debateMatchId: string,
): DebateMatch | undefined {
  return getMatches(tournament).find(
    (match) => match.debateMatchId === debateMatchId,
  )
}

export function getAdjacentMatches(
  tournament: DebateTournament,
  debateMatchId: string,
): { previous?: DebateMatch; next?: DebateMatch } {
  const matches = getMatches(tournament)
  const matchIndex = matches.findIndex(
    (match) => match.debateMatchId === debateMatchId,
  )
  if (matchIndex === -1) return {}

  return {
    previous: matches[matchIndex - 1],
    next: matches[matchIndex + 1],
  }
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

export function getClosestAlternative(
  tournament: DebateTournament,
): DebateIdea | undefined {
  const finalMatch = getFinalMatch(tournament)
  if (!finalMatch?.winnerIdeaId) return undefined

  if (finalMatch.firstIdea.ideaId === finalMatch.winnerIdeaId) {
    return finalMatch.secondIdea
  }
  if (finalMatch.secondIdea.ideaId === finalMatch.winnerIdeaId) {
    return finalMatch.firstIdea
  }
  return undefined
}

export function getWinnerReason(
  tournament: DebateTournament,
): string | undefined {
  const finalMatch = getFinalMatch(tournament)
  return finalMatch?.messages
    .toSorted(
      (first, second) =>
        second.position - first.position ||
        second.debateMessageId.localeCompare(first.debateMessageId),
    )
    .find((message) => message.speakerSlot === 2 && message.text.trim())
    ?.text.trim()
}
