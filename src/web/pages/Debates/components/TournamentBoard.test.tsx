import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  completedTournament,
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

  it("distinguishes provisional leaders from finalized qualifiers", () => {
    const { rerender } = render(
      <TournamentBoard tournament={swissTournament} />,
    )

    expect(screen.getAllByText("Provisional top four")).toHaveLength(4)
    expect(screen.queryByText("Top four")).not.toBeInTheDocument()

    rerender(<TournamentBoard tournament={completedTournament} />)

    expect(screen.getAllByText("Top four")).toHaveLength(4)
    expect(screen.queryByText("Provisional top four")).not.toBeInTheDocument()
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
