import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DeepSearchRunState } from "../../../lib/deepSearchState.ts"

const mocks = vi.hoisted(() => ({ subscribeToTextStream: vi.fn() }))

vi.mock("../../../lib/textStreams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

import { DeepSearchRoundDetail } from "./DeepSearchRoundDetail.tsx"

function run(
  overrides: Partial<DeepSearchRunState> = {},
): DeepSearchRunState {
  return {
    error: null,
    finalAnswerStreamId: "final-answer",
    queryGenerations: [
      { round: 0, streamId: "queries-round-1" },
      { round: 2, streamId: "queries-round-3" },
    ],
    roundAnswers: [
      { round: 0, streamId: "answer-round-1" },
      { round: 2, streamId: "answer-round-3" },
    ],
    roundReviews: [
      {
        reason: "The available evidence covers the requested angles.",
        round: 0,
        status: "stop",
      },
      {
        reason: "The follow-up evidence closes the remaining gap.",
        round: 2,
        status: "stop",
      },
    ],
    searches: [
      {
        query: "Official evidence for the question",
        results: [
          {
            link: "https://example.com/evidence",
            selection: "selected",
            shortText: "A useful source summary.",
            title: "Useful source",
          },
        ],
        round: 0,
      },
    ],
    status: "completed",
    ...overrides,
  }
}

function renderDetail(
  props: Partial<Parameters<typeof DeepSearchRoundDetail>[0]> = {},
) {
  return render(
    <MemoryRouter>
      <DeepSearchRoundDetail
        jobSlug="grid storage / future"
        jobTitle="Future of grid storage"
        maxRounds={5}
        researchRequest="What storage technologies can scale safely?"
        roundNumber={1}
        run={run()}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe("DeepSearchRoundDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.subscribeToTextStream.mockImplementation(
      async function* (streamId: string) {
        await Promise.resolve()
        const text =
          streamId === "queries-round-1"
            ? '["official storage evidence"]'
            : streamId === "answer-round-1"
              ? "The evidence supports a diversified storage strategy."
              : "Additional round output."
        yield { type: "text" as const, text }
        yield { type: "done" as const }
      },
    )
  })

  it("renders one round as a page without a nested round accordion", async () => {
    renderDetail()

    expect(screen.getByRole("link", { name: "Back to research" })).toHaveAttribute(
      "href",
      "/deep-search/grid%20storage%20%2F%20future",
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Round 1" }),
    ).toBeVisible()
    expect(screen.getByText("Future of grid storage")).toBeVisible()
    expect(screen.getByText("Complete")).toBeVisible()
    expect(
      screen.getByText(
        "The candidate answer and supporting evidence are ready.",
      ),
    ).toBeVisible()
    expect(
      screen.getByText("What storage technologies can scale safely?"),
    ).toBeVisible()

    expect(
      screen.queryByRole("heading", { level: 3, name: "Search queries" }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText("Official evidence for the question")).toHaveLength(
      1,
    )
    expect(
      screen.getByRole("heading", { level: 3, name: "Research results" }),
    ).toBeVisible()
    expect(
      screen.getByRole("heading", {
        level: 4,
        name: "Official evidence for the question",
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("heading", {
        level: 5,
        name: /^Source results/,
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: "Show source results for Official evidence for the question",
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("heading", { level: 3, name: "Candidate answer" }),
    ).toBeVisible()
    expect(await screen.findByTestId("round-answer-0")).toHaveTextContent(
      "The evidence supports a diversified storage strategy.",
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Research is sufficient. The available evidence covers the requested angles.",
    )
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Round 1 research review",
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Evidence review" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByText(/The available evidence covers the requested angles\./),
    ).toHaveLength(1)
    expect(
      screen.getByRole("link", { name: "Next round: Round 3" }),
    ).toHaveAttribute(
      "href",
      "/deep-search/grid%20storage%20%2F%20future/rounds/3",
    )
    expect(
      screen.queryByRole("button", { name: /Round 1 Complete/ }),
    ).not.toBeInTheDocument()
  })

  it("links to the previous and next rounds that are actually present", () => {
    renderDetail({ roundNumber: 3 })

    const navigation = screen.getByRole("navigation", {
      name: "Research round navigation",
    })
    expect(
      within(navigation).getByRole("link", { name: "Previous round: Round 1" }),
    ).toHaveAttribute(
      "href",
      "/deep-search/grid%20storage%20%2F%20future/rounds/1",
    )
    expect(
      within(navigation).queryByRole("link", { name: /Next round/ }),
    ).not.toBeInTheDocument()
  })

  it("shows a stable round heading while a valid future round is loading", () => {
    renderDetail({
      roundNumber: 2,
      run: run({
        finalAnswerStreamId: null,
        queryGenerations: [{ round: 0, streamId: "queries-round-1" }],
        roundAnswers: [],
        roundReviews: [],
        searches: [],
        status: "running",
      }),
    })

    expect(
      screen.getByRole("heading", { level: 1, name: "Round 2" }),
    ).toBeVisible()
    expect(screen.getByRole("progressbar", { name: "Loading round" })).toBeVisible()
    expect(screen.getByText("Loading round…")).toBeVisible()
    expect(screen.queryByText("Round not found")).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Previous round: Round 1" }),
    ).toHaveAttribute(
      "href",
      "/deep-search/grid%20storage%20%2F%20future/rounds/1",
    )
  })

  it("shows a stopped status for a failed round while preserving partial work", () => {
    renderDetail({
      run: run({
        error: "Internal provider details",
        finalAnswerStreamId: null,
        queryGenerations: [{ round: 0, streamId: "queries-round-1" }],
        roundAnswers: [],
        roundReviews: [],
        searches: [],
        status: "failed",
      }),
    })

    expect(screen.getByText("Stopped")).toBeVisible()
    expect(
      screen.getByRole("heading", { level: 3, name: "Search queries" }),
    ).toBeVisible()
    expect(
      screen.getByText(
        "Research stopped before this round could finish. Any available work is shown below.",
      ),
    ).toBeVisible()
    expect(screen.queryByText("Internal provider details")).not.toBeInTheDocument()
  })

  it.each([
    [true, "Stopped"],
    [false, "Interrupted"],
  ] as const)(
    "distinguishes stopped=%s on a direct round URL",
    (stopRequested, label) => {
      renderDetail({
        stopRequested,
        run: run({
          error: "Workflow ended",
          finalAnswerStreamId: null,
          roundAnswers: [],
          roundReviews: [],
          status: "interrupted",
        }),
      })

      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    },
  )

  it("shows not found for a valid but absent round after the run is terminal", () => {
    renderDetail({
      roundNumber: 2,
      run: run({
        queryGenerations: [{ round: 0, streamId: "queries-round-1" }],
        roundAnswers: [],
        roundReviews: [],
        searches: [],
      }),
    })

    expect(
      screen.getByRole("heading", { level: 1, name: "Round not found" }),
    ).toBeVisible()
    expect(
      screen.getByText("This round does not exist in this research job."),
    ).toBeVisible()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it.each([Number.NaN, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, 6])(
    "shows not found for malformed or out-of-range round number %s",
    (roundNumber) => {
      renderDetail({
        roundNumber,
        run: run({ status: "running", finalAnswerStreamId: null }),
      })

      expect(
        screen.getByRole("heading", { level: 1, name: "Round not found" }),
      ).toBeVisible()
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    },
  )
})
