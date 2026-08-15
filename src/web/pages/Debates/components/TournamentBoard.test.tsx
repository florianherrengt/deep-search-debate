import { fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import {
  completedTournament,
  semifinalTournament,
  swissTournament,
} from "../stories/fixtures.ts"
import { TournamentBoard } from "./TournamentBoard.tsx"

function renderBoard(tournament: Parameters<typeof TournamentBoard>[0]["tournament"]) {
  return render(
    <MemoryRouter>
      <TournamentBoard tournament={tournament} />
    </MemoryRouter>,
  )
}

describe("TournamentBoard", () => {
  it("presents tournament information as semantic sections instead of equal outer cards", () => {
    renderBoard(completedTournament)

    expect(
      screen.getByRole("region", { name: "Debate progress" }),
    ).toBeVisible()
    expect(screen.getByRole("region", { name: "Knockout" })).toBeVisible()
    expect(
      screen.getByRole("region", { name: "Debate rounds" }),
    ).toBeVisible()
    expect(screen.getByRole("region", { name: "Standings" })).toBeVisible()
  })

  it("groups standings before debate rounds in the tournament detail area", () => {
    renderBoard(semifinalTournament)

    const details = screen.getByRole("group", {
      name: "Standings and debate rounds",
    })
    const standings = within(details).getByRole("region", {
      name: "Standings",
    })
    const rounds = within(details).getByRole("region", {
      name: "Debate rounds",
    })

    expect(
      standings.compareDocumentPosition(rounds) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("moves the expanded round forward as live Swiss snapshots arrive", () => {
    const firstRoundSnapshot = {
      ...swissTournament,
      rounds: swissTournament.rounds.slice(0, 1),
    }
    const { rerender } = renderBoard(firstRoundSnapshot)
    const firstRound = screen.getByRole("button", { name: /Round 1/ })

    expect(firstRound).toHaveAttribute("aria-expanded", "true")

    rerender(
      <MemoryRouter>
        <TournamentBoard tournament={swissTournament} />
      </MemoryRouter>,
    )

    expect(firstRound).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("button", { name: /Round 2/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  it("allows manual round toggling and closes Swiss rounds at knockout", () => {
    const { rerender } = renderBoard(swissTournament)
    const firstRound = screen.getByRole("button", { name: /Round 1/ })
    const secondRound = screen.getByRole("button", { name: /Round 2/ })

    fireEvent.click(secondRound)
    expect(secondRound).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(firstRound)
    expect(firstRound).toHaveAttribute("aria-expanded", "true")

    rerender(
      <MemoryRouter>
        <TournamentBoard
          tournament={{ ...swissTournament, stage: "semifinal" }}
        />
      </MemoryRouter>,
    )

    expect(firstRound).toHaveAttribute("aria-expanded", "false")
    expect(secondRound).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(secondRound)
    expect(secondRound).toHaveAttribute("aria-expanded", "true")
  })

  it("marks unfinished matches as stopped after a terminal failure", () => {
    renderBoard({ ...swissTournament, status: "failed" })

    expect(screen.queryByText("Live")).not.toBeInTheDocument()
    expect(screen.getAllByText("Stopped").length).toBeGreaterThan(0)
  })

  it("marks the ideas returned in the knockout round as advanced", () => {
    const { rerender } = renderBoard(swissTournament)

    expect(screen.queryByText("Advanced")).not.toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <TournamentBoard tournament={semifinalTournament} />
      </MemoryRouter>,
    )

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

    renderBoard({
      ...semifinalTournament,
      rounds: semifinalTournament.rounds.map((round) =>
        round.stage === "semifinal"
          ? { ...round, matches: [...round.matches, extraMatch] }
          : round,
      ),
    })

    expect(
      screen.getByRole("link", {
        name: "Open Extra first idea versus Extra second idea",
      }),
    ).toHaveAttribute(
      "href",
      "/debates/independent-cafe-energy-ideas/matches/extra-knockout-match",
    )
  })

  it("presents model ratings without exposing implementation jargon", () => {
    renderBoard({
      ...completedTournament,
      standings: completedTournament.standings.map((standing, index) =>
        index === 0 ? { ...standing, elo: 1578.402416378157 } : standing,
      ),
    })

    expect(screen.getByRole("columnheader", { name: "Rating" })).toBeVisible()
    expect(screen.queryByText("Elo")).not.toBeInTheDocument()
    expect(screen.getByText("1578")).toBeVisible()
    expect(screen.queryByText("1578.402416378157")).not.toBeInTheDocument()
  })

  it("links standings back to each generated idea detail", () => {
    renderBoard(completedTournament)

    const firstStanding = completedTournament.standings[0]
    expect(
      screen.getByRole("link", { name: firstStanding.idea.title }),
    ).toHaveAttribute(
      "href",
      `/ideas/${completedTournament.slug}/${firstStanding.idea.ideaId}#improved-idea`,
    )
  })
})
