import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { swissTournament } from "../stories/fixtures.ts"
import { DebateMatchDetail } from "./DebateMatchDetail.tsx"

function renderMatch(debateMatchId: string) {
  const matches = swissTournament.rounds.flatMap((round) => round.matches)
  const match = matches.find(
    (candidate) => candidate.debateMatchId === debateMatchId,
  )
  if (!match) throw new Error(`Missing fixture match ${debateMatchId}`)

  return render(
    <MemoryRouter>
      <DebateMatchDetail match={match} tournament={swissTournament} />
    </MemoryRouter>,
  )
}

describe("DebateMatchDetail", () => {
  it("labels adjacent-match navigation buttons with the match names while keeping direction for screen readers", () => {
    const { unmount } = renderMatch("swiss-2-2")
    const matches = swissTournament.rounds.flatMap((round) => round.matches)
    const index = matches.findIndex(
      (candidate) => candidate.debateMatchId === "swiss-2-2",
    )
    const previous = matches[index - 1]
    const next = matches[index + 1]

    expect(previous).toBeDefined()
    expect(next).toBeDefined()

    const previousButton = screen.getByRole("link", {
      name: `Previous: ${previous.firstIdea.title} versus ${previous.secondIdea.title}`,
    })
    const nextButton = screen.getByRole("link", {
      name: `Next: ${next.firstIdea.title} versus ${next.secondIdea.title}`,
    })

    expect(previousButton).toBeVisible()
    expect(previousButton).toHaveTextContent(
      `${previous.firstIdea.title} versus ${previous.secondIdea.title}`,
    )
    expect(nextButton).toBeVisible()
    expect(nextButton).toHaveTextContent(
      `${next.firstIdea.title} versus ${next.secondIdea.title}`,
    )
    unmount()
  })

  it("renders navigation without generic Previous/Next copy", () => {
    const { unmount } = renderMatch("swiss-2-2")

    expect(screen.queryByText("Previous")).not.toBeInTheDocument()
    expect(screen.queryByText("Next")).not.toBeInTheDocument()
    unmount()
  })
})
