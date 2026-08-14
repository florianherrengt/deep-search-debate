import { act, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import type { DeepSearchRunState } from "../../../lib/deepSearchState.ts"
import { DeepSearchOverview } from "./DeepSearchOverview.tsx"

const baseRun: DeepSearchRunState = {
  status: "running",
  queryGenerations: [{ round: 0, streamId: "round-one-queries" }],
  roundAnswers: [{ round: 0, streamId: "round-one-answer" }],
  roundReviews: [
    {
      round: 0,
      streamId: "round-one-review",
      status: "running",
    },
  ],
  finalAnswerStreamId: null,
  searches: [
    {
      round: 0,
      query: "first query",
      results: [],
    },
    {
      round: 0,
      query: "second query",
      results: [],
    },
  ],
  error: null,
}

function renderOverview(run: DeepSearchRunState = baseRun) {
  return render(
    <MemoryRouter>
      <DeepSearchOverview
        jobSlug="research-this"
        researchRequest="Research this carefully"
        run={run}
        title="Research this"
      />
    </MemoryRouter>,
  )
}

describe("DeepSearchOverview", () => {
  it("keeps the main page compact and links to round details", () => {
    renderOverview()

    expect(
      screen.getByRole("heading", { level: 2, name: "Research rounds" }),
    ).toBeVisible()
    const roundLink = screen.getByRole("link", { name: /Round 1/ })
    expect(roundLink).toHaveAttribute(
      "href",
      "/deep-search/research-this/rounds/1",
    )
    expect(within(roundLink).getByText("In progress")).toBeVisible()
    expect(within(roundLink).getByText("2 searches")).toBeVisible()
    expect(
      screen.getAllByText("Reviewing whether more research is needed…"),
    ).toHaveLength(1)
    expect(screen.queryByText("first query")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Research results" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Research in progress/ }),
    ).not.toBeInTheDocument()
  })

  it("keeps a focused round link mounted as live research completes", () => {
    const { rerender } = renderOverview()
    const roundLink = screen.getByRole("link", { name: /Round 1/ })
    act(() => roundLink.focus())

    rerender(
      <MemoryRouter>
        <DeepSearchOverview
          jobSlug="research-this"
          researchRequest="Research this carefully"
          run={{
            ...baseRun,
            status: "completed",
            roundReviews: [
              {
                round: 0,
                status: "stop",
                reason: "The available evidence is sufficient.",
              },
            ],
          }}
          title="Research this"
        />
      </MemoryRouter>,
    )

    const completedLink = screen.getByRole("link", { name: /Round 1/ })
    expect(completedLink).toBe(roundLink)
    expect(completedLink).toHaveFocus()
    expect(within(completedLink).getByText("Complete")).toBeVisible()
    expect(
      within(completedLink).getByText("The available evidence is sufficient."),
    ).toBeVisible()
  })

  it("marks an unfinished round as stopped after a fatal failure", () => {
    renderOverview({
      ...baseRun,
      status: "failed",
      error: "Research failed",
      roundAnswers: [],
      roundReviews: [],
    })

    const roundLink = screen.getByRole("link", { name: /Round 1/ })
    expect(within(roundLink).getByText("Stopped")).toBeVisible()
    expect(
      within(roundLink).getByText(
        "Research stopped before this round could finish.",
      ),
    ).toBeVisible()
  })

  it("does not promise round navigation before a round exists", () => {
    renderOverview({
      ...baseRun,
      queryGenerations: [],
      roundAnswers: [],
      roundReviews: [],
      searches: [],
    })

    expect(
      screen.queryByRole("heading", { name: "Research rounds" }),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Starting deep search…")).toBeVisible()
  })
})
