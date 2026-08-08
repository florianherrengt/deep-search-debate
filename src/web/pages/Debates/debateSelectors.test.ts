import { describe, expect, it } from "vitest"
import {
  getCompletedMatchCount,
  getCurrentSwissRound,
  getSelectedMatch,
  getSwissRounds,
  getWinner,
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
): DebateMatch {
  return {
    debateMatchId,
    position: 0,
    firstIdea,
    secondIdea,
    winnerIdeaId,
    status,
    messages: [],
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
      matches: [match("final", "completed", secondIdea.ideaId)],
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
  })

  it("prefers an explicit selection, then a running match", () => {
    expect(getSelectedMatch(tournament, "completed")?.debateMatchId).toBe(
      "completed",
    )
    expect(getSelectedMatch(tournament, null)?.debateMatchId).toBe("running")
  })
})
