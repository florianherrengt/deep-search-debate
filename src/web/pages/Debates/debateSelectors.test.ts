import { describe, expect, it } from "vitest"
import {
  getAdjacentMatches,
  getCompletedMatchCount,
  getCurrentSwissRound,
  getClosestAlternative,
  getMatch,
  getSwissRounds,
  getWinner,
  getWinnerReason,
} from "./debateSelectors.ts"
import type {
  DebateIdea,
  DebateMatch,
  DebateTournament,
} from "./debateUiTypes.ts"

const firstIdea: DebateIdea = {
  ideaId: "first",
  position: 0,
  title: "First idea",
  description: "First description",
}
const secondIdea: DebateIdea = {
  ideaId: "second",
  position: 1,
  title: "Second idea",
  description: "Second description",
}

function match(
  debateMatchId: string,
  status: DebateMatch["status"],
  winnerIdeaId: string | null = null,
  messages: DebateMatch["messages"] = [],
): DebateMatch {
  return {
    debateMatchId,
    position: 0,
    firstIdea,
    secondIdea,
    winnerIdeaId,
    status,
    messages,
  }
}

const tournament: DebateTournament = {
  debateJobId: "debate",
  ideaJobId: "ideas",
  title: "Prompt",
  slug: "prompt",
  prompt: "Prompt",
  isPublic: false,
  isOwner: true,
  stage: "final",
  status: "completed",
  expectedMatchCount: 4,
  rounds: [
    {
      debateRoundId: "swiss-two",
      stage: "swiss",
      stageRoundNumber: 2,
      matches: [match("completed", "completed", firstIdea.ideaId)],
    },
    {
      debateRoundId: "swiss-one",
      stage: "swiss",
      stageRoundNumber: 1,
      matches: [match("running", "running")],
    },
    {
      debateRoundId: "final",
      stage: "final",
      stageRoundNumber: 1,
      matches: [
        match("final", "completed", secondIdea.ideaId, [
          {
            debateMessageId: "judge-verdict",
            llmGenerationId: "judge-generation",
            position: 4,
            speakerSlot: 2,
            text: "Second idea wins because it is easier to validate.",
            createdAt: new Date("2026-08-12T10:00:00.000Z"),
          },
        ]),
      ],
    },
  ],
  standings: [],
  error: null,
}

describe("debate selectors", () => {
  it("derives progress, the latest Swiss round, and the winner", () => {
    expect(getCompletedMatchCount(tournament)).toBe(2)
    expect(getCurrentSwissRound(tournament)?.debateRoundId).toBe("swiss-two")
    expect(getSwissRounds(tournament).map((round) => round.debateRoundId)).toEqual(
      ["swiss-one", "swiss-two"],
    )
    expect(getWinner(tournament)).toBe(secondIdea)
    expect(getClosestAlternative(tournament)).toBe(firstIdea)
    expect(getWinnerReason(tournament)).toBe(
      "Second idea wins because it is easier to validate.",
    )
  })

  it("does not invent a closest alternative before the final is decided", () => {
    expect(
      getClosestAlternative({
        ...tournament,
        rounds: tournament.rounds.map((round) =>
          round.stage === "final"
            ? {
                ...round,
                matches: round.matches.map((finalMatch) => ({
                  ...finalMatch,
                  status: "running" as const,
                  winnerIdeaId: null,
                })),
              }
            : round,
        ),
      }),
    ).toBeUndefined()
  })

  it("finds a routed match and its previous and next matches", () => {
    expect(getMatch(tournament, "running")?.debateMatchId).toBe("running")
    expect(getMatch(tournament, "missing")).toBeUndefined()
    const adjacentMatches = getAdjacentMatches(tournament, "running")
    expect(adjacentMatches.previous?.debateMatchId).toBe("completed")
    expect(adjacentMatches.next?.debateMatchId).toBe("final")
    expect(getAdjacentMatches(tournament, "missing")).toEqual({})
  })
})
