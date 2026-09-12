import { act, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import type { DeepSearchRunState } from "../../../lib/deepSearchState.ts"
import { DeepSearchOverview } from "./DeepSearchOverview.tsx"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"

const baseRun: DeepSearchRunState = {
  roundRequirements: [],
  linkedSources: [],
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
  researchAnalysis: null,
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

function renderOverview(
  run: DeepSearchRunState = baseRun,
  stopRequested = false,
) {
  return render(
    <MemoryRouter>
      <DeepSearchOverview
        jobSlug="research-this"
        researchRequest="Research this carefully"
        run={run}
        stopRequested={stopRequested}
        title="Research this"
      />
    </MemoryRouter>,
  )
}

describe("DeepSearchOverview", () => {
  it("keeps even completed correction text provisional until the job completes", async () => {
    const subscribe = async function* () {
      await Promise.resolve()
      yield { type: "text" as const, text: "The revised answer retains the qualification." }
      yield { type: "done" as const }
    }
    const view = (status: DeepSearchRunState["status"]) => <TextStreamProvider subscribe={subscribe}><MemoryRouter><DeepSearchOverview jobSlug="checked-answer" title="Checked answer" researchRequest="Check the qualification" run={{ ...baseRun, finalAnswerStreamId: "correction", status }} /></MemoryRouter></TextStreamProvider>
    const { rerender } = render(view("running"))
    expect(await screen.findByText("The revised answer retains the qualification.")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Answer under review" })).toBeVisible()
    expect(screen.getByText("Checking final answer…")).toBeVisible()
    expect(screen.queryByRole("heading", { name: "Final answer" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Research is complete/)).not.toBeInTheDocument()
    rerender(view("completed"))
    expect(screen.getByRole("heading", { name: "Final answer" })).toBeVisible()
    expect(screen.queryByText("Checking final answer…")).not.toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    expect(screen.getByText("The revised answer retains the qualification.")).toBeVisible()
  })

  it.each(["failed", "interrupted", "stopping"] as const)("shows a %s correction as a partial answer without active copy", (status) => {
    renderOverview({ ...baseRun, status, finalAnswerStreamId: "correction" })
    expect(screen.getByRole("heading", { name: "Partial answer" })).toBeVisible()
    expect(screen.queryByText("Checking final answer…")).not.toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it("shows final requirement coverage while legacy analysis remains valid", () => {
    renderOverview({ ...baseRun, status: "completed", researchAnalysis: { facts: [], disagreements: [], gaps: [], assumptions: [], requirements: [
      { requirement: "Verify the latest release", kind: "requirement", status: "conflicting", sources: ["https://example.com/releases"], explanation: "The sources disagree about which release is available." },
    ] } })
    const coverage = screen.getByRole("region", { name: "Requirement coverage" })
    expect(within(coverage).getByText("Requirement · Conflicting evidence")).toBeVisible()
    expect(within(coverage).getByText("The sources disagree about which release is available.")).toBeVisible()
    expect(within(coverage).getByRole("link", { name: "Open source: https://example.com/releases" })).toHaveAttribute("href", "https://example.com/releases")
  })
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

  it("displays the separate facts, disagreements, gaps, and assumptions analysis", () => {
    renderOverview({
      ...baseRun,
      status: "completed",
      finalAnswerStreamId: "final-answer",
      researchAnalysis: {
        facts: [
          {
            title: "Supported fact",
            description: "The collected evidence supports this claim.",
            sources: ["https://example.com/fact"],
          },
        ],
        disagreements: [],
        gaps: [
          {
            title: "Missing regional evidence",
            description: "The research does not cover every region.",
          },
        ],
        assumptions: [],
      },
    })

    expect(
      screen.getByRole("heading", { level: 2, name: "Research analysis" }),
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "Facts" })).toBeVisible()
    expect(screen.getByText("Supported fact")).toBeVisible()
    expect(
      screen.getByRole("link", {
        name: "Open source: https://example.com/fact",
      }),
    ).toHaveAttribute("href", "https://example.com/fact")
    expect(screen.getByRole("heading", { name: "Disagreements" })).toBeVisible()
    expect(screen.getByText("No material disagreements were identified.")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Gaps" })).toBeVisible()
    expect(screen.getByText("Missing regional evidence")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Assumptions" })).toBeVisible()
  })

  it("ceases active presentation as soon as a durable Stop is requested", () => {
    renderOverview(baseRun, true)

    expect(
      screen.getByText("Stopping research after in-progress work settles."),
    ).toBeVisible()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    expect(
      within(screen.getByRole("link", { name: /Round 1/ })).getByText(
        "Stopped",
      ),
    ).toBeVisible()
  })

  it.each([
    [true, "Stopped", "Research was stopped before completion. Available work has been kept."],
    [false, "Interrupted", "Research was interrupted before completion. Available work has been kept."],
  ] as const)(
    "distinguishes stopped=%s from restart interruption",
    (stopRequested, label, description) => {
      renderOverview(
        { ...baseRun, status: "interrupted", error: "Workflow ended" },
        stopRequested,
      )

      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
      expect(screen.getByText(description)).toBeVisible()
    },
  )
})
