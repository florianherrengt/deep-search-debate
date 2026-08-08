import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  completedTournament,
  semifinalTournament,
  swissTournament,
} from "../stories/fixtures.ts"
import { TournamentBoard } from "./TournamentBoard.tsx"

describe("TournamentBoard", () => {
  it("marks unfinished matches as stopped after a terminal failure", () => {
    render(
      <TournamentBoard tournament={{ ...swissTournament, status: "failed" }} />,
    )

    expect(screen.queryByText("Live")).not.toBeInTheDocument()
    expect(screen.getAllByText("Stopped").length).toBeGreaterThan(0)
  })

  it("marks the ideas returned in the knockout round as advanced", () => {
    const { rerender } = render(
      <TournamentBoard tournament={swissTournament} />,
    )

    expect(screen.queryByText("Advanced")).not.toBeInTheDocument()

    rerender(<TournamentBoard tournament={semifinalTournament} />)

    expect(screen.getAllByText("Advanced")).toHaveLength(4)
  })

  it("renders every match returned for the knockout round", () => {
    const knockoutRound = semifinalTournament.rounds.find(
      (round) => round.stage === "semifinal",
    )
    if (!knockoutRound) throw new Error("Missing knockout fixture")

    const extraMatch = {
      ...knockoutRound.matches[0],
      debateMatchId: "extra-knockout-match",
      position: 2,
      firstIdea: {
        ...knockoutRound.matches[0].firstIdea,
        ideaId: "extra-first-idea",
        title: "Extra first idea",
      },
      secondIdea: {
        ...knockoutRound.matches[0].secondIdea,
        ideaId: "extra-second-idea",
        title: "Extra second idea",
      },
      winnerIdeaId: null,
    }

    render(
      <TournamentBoard
        tournament={{
          ...semifinalTournament,
          rounds: semifinalTournament.rounds.map((round) =>
            round.stage === "semifinal"
              ? { ...round, matches: [...round.matches, extraMatch] }
              : round,
          ),
        }}
      />,
    )

    expect(
      screen.getByRole("button", {
        name: "Open Extra first idea versus Extra second idea",
      }),
    ).toBeVisible()
  })

  it("rounds Elo only for presentation", () => {
    render(
      <TournamentBoard
        tournament={{
          ...completedTournament,
          standings: completedTournament.standings.map((standing, index) =>
            index === 0 ? { ...standing, elo: 1578.402416378157 } : standing,
          ),
        }}
      />,
    )

    expect(screen.getByText("1578")).toBeVisible()
    expect(screen.queryByText("1578.402416378157")).not.toBeInTheDocument()
  })
})
