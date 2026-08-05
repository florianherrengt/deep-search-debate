import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../../lib/api.ts"

const mocks = vi.hoisted(() => ({
  createDeepSearchJob: vi.fn(),
  getDeepSearchJob: vi.fn(),
  getDeepSearchJobs: vi.fn(),
  subscribeToDeepSearchJob: vi.fn(),
  subscribeToTextStream: vi.fn(),
}))

vi.mock("../../lib/deepSearchJobs.ts", () => ({
  createDeepSearchJob: mocks.createDeepSearchJob,
  getDeepSearchJob: mocks.getDeepSearchJob,
  getDeepSearchJobs: mocks.getDeepSearchJobs,
  subscribeToDeepSearchJob: mocks.subscribeToDeepSearchJob,
}))

vi.mock("../../lib/textStreams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

import { DeepSearch } from "./index.tsx"

function renderDeepSearch(initialEntry = "/deep-search") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/deep-search" element={<DeepSearch />} />
          <Route
            path="/deep-search/:deepSearchJobId"
            element={<DeepSearch />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function deepSearchJob() {
  return {
    deepSearchJobId: "job-id",
    researchRequest: "Research this",
    maxSearches: 3,
    maxResultsPerSearch: 3,
    status: "completed" as const,
    error: null,
    createdAt: new Date(),
    completedAt: new Date(),
  }
}

describe("DeepSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDeepSearchJobs.mockResolvedValue([])
    mocks.getDeepSearchJob.mockResolvedValue(deepSearchJob())
    mocks.subscribeToDeepSearchJob.mockImplementation(async function* () {
      await Promise.resolve()
      yield { type: "done" as const }
    })
  })

  it("disables submission until the request contains text", () => {
    renderDeepSearch()

    const submit = screen.getByRole("button", { name: "Start deep search" })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Research request"), {
      target: { value: "Research accessible energy tools" },
    })

    expect(submit).toBeEnabled()
  })

  it("creates a job, subscribes, and displays search results", async () => {
    async function* events() {
      await Promise.resolve()
      yield { type: "query-stream" as const, streamId: "query-stream-id" }
      yield {
        type: "search-results" as const,
        searches: [
          {
            query: "test query",
            results: [
              {
                title: "Useful result",
                shortText: "A useful description",
                link: "https://example.com/result",
              },
              {
                title: "Unselected result",
                shortText: "Another description",
                link: "https://example.com/unselected",
              },
            ],
          },
        ],
      }
      yield {
        type: "selection-stream" as const,
        query: "test query",
        streamId: "selection-stream-id",
      }
      yield {
        type: "selected-search-results" as const,
        query: "test query",
        selectedLinks: ["https://example.com/result"],
      }
      yield {
        type: "page-summary-stream" as const,
        url: "https://example.com/result",
        streamId: "summary-stream-id",
      }
      yield {
        type: "query-summary-stream" as const,
        query: "test query",
        streamId: "query-summary-stream-id",
      }
      yield {
        type: "final-answer-stream" as const,
        streamId: "final-answer-stream-id",
      }
      yield { type: "done" as const }
    }
    async function* summaryEvents() {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Finding relevant facts" }
      yield { type: "text" as const, text: "A relevant " }
      yield { type: "text" as const, text: "page summary" }
      yield { type: "done" as const }
    }
    async function* querySummaryEvents() {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Combining all results" }
      yield { type: "text" as const, text: "The search found " }
      yield { type: "text" as const, text: "useful evidence." }
      yield { type: "done" as const }
    }
    async function* finalAnswerEvents() {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Synthesizing the research" }
      yield { type: "text" as const, text: "The final researched " }
      yield { type: "text" as const, text: "answer." }
      yield { type: "done" as const }
    }
    async function* queryGenerationEvents() {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Prioritizing queries" }
      yield { type: "text" as const, text: "test query" }
      yield { type: "done" as const }
    }
    async function* selectionEvents() {
      await Promise.resolve()
      yield {
        type: "reasoning" as const,
        text: "Comparing source relevance",
      }
      yield { type: "text" as const, text: '["result-0"]' }
      yield { type: "done" as const }
    }
    mocks.createDeepSearchJob.mockResolvedValue("job-id")
    mocks.subscribeToDeepSearchJob.mockReturnValue(events())
    mocks.subscribeToTextStream.mockImplementation((id: string) => {
      if (id === "query-stream-id") return queryGenerationEvents()
      if (id === "selection-stream-id") return selectionEvents()
      if (id === "summary-stream-id") return summaryEvents()
      if (id === "query-summary-stream-id") return querySummaryEvents()
      if (id === "final-answer-stream-id") return finalAnswerEvents()
      throw new Error(`Unexpected stream: ${id}`)
    })

    renderDeepSearch()
    fireEvent.change(screen.getByLabelText("Research request"), {
      target: { value: "Research this" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start deep search" }))

    expect(await screen.findByText("Useful result")).toBeInTheDocument()
    expect(screen.getByText("A useful description")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Research results" }),
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "test query" })).toBeVisible()
    expect(screen.getByText("2 results")).toBeVisible()
    expect(screen.getByText("1 explored in depth")).toBeVisible()
    expect(screen.queryByLabelText("Research request")).not.toBeInTheDocument()
    expect(screen.queryByText("Job: job-id")).not.toBeInTheDocument()

    const reasoningSections = [
      {
        container: screen
          .getByText("Generated search queries")
          .closest(".MuiPaper-root"),
        reasoning: "Prioritizing queries",
      },
      {
        container: screen
          .getByText("Source selection")
          .closest(".MuiPaper-root"),
        reasoning: "Comparing source relevance",
      },
      {
        container: screen
          .getByText("What this search found")
          .closest("section"),
        reasoning: "Combining all results",
      },
      {
        container: screen.getByText("Final answer").closest(".MuiPaper-root"),
        reasoning: "Synthesizing the research",
      },
    ]
    for (const { container, reasoning } of reasoningSections) {
      if (!(container instanceof HTMLElement)) {
        throw new Error("Reasoning section was not rendered")
      }
      const toggle = await within(container).findByRole("button", {
        name: "Show reasoning",
      })
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      expect(screen.queryByText(reasoning)).not.toBeInTheDocument()
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute("aria-expanded", "true")
      expect(screen.getByText(reasoning)).toBeVisible()
    }

    const sourceResults = screen.getByRole("button", {
      name: "Show source results for test query",
    })
    expect(sourceResults).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(sourceResults)
    expect(sourceResults).toHaveAttribute("aria-expanded", "true")
    expect(screen.queryByText("Finding relevant facts")).not.toBeInTheDocument()
    const sourceReasoningToggle = await screen.findByRole("button", {
      name: "Show reasoning",
    })
    fireEvent.click(sourceReasoningToggle)
    expect(screen.getByText("Finding relevant facts")).toBeVisible()
    expect(await screen.findByText("A relevant page summary")).toBeVisible()
    expect(screen.getByTestId("query-summary-test query")).toHaveTextContent(
      "The search found useful evidence.",
    )
    expect(screen.getByTestId("final-answer")).toHaveTextContent(
      "The final researched answer.",
    )
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Final answer: Response complete",
    )
    expect(screen.getByText("Explored source")).toBeVisible()
    expect(screen.getByText("Search listing")).toBeVisible()
    expect(screen.getByRole("link", { name: "Useful result" })).toHaveAttribute(
      "href",
      "https://example.com/result",
    )
    expect(
      screen
        .getByRole("link", { name: "Useful result" })
        .closest(".MuiPaper-root"),
    ).toHaveAttribute("data-selection-status", "selected")
    expect(
      screen
        .getByRole("link", { name: "Unselected result" })
        .closest(".MuiPaper-root"),
    ).toHaveAttribute("data-selection-status", "rejected")
    expect(mocks.createDeepSearchJob).toHaveBeenCalledWith(
      { researchRequest: "Research this" },
    )
    expect(mocks.subscribeToDeepSearchJob).toHaveBeenCalledWith(
      "job-id",
      expect.any(AbortSignal),
      expect.any(Function),
    )
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "query-stream-id",
      expect.any(AbortSignal),
      expect.any(Function),
    )
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "selection-stream-id",
      expect.any(AbortSignal),
      expect.any(Function),
    )
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "summary-stream-id",
      expect.any(AbortSignal),
      expect.any(Function),
    )
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "query-summary-stream-id",
      expect.any(AbortSignal),
      expect.any(Function),
    )
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "final-answer-stream-id",
      expect.any(AbortSignal),
      expect.any(Function),
    )
  })

  it("consumes page summary streams without blocking job events", async () => {
    const firstSummaryGate = Promise.withResolvers<void>()

    async function* events() {
      await Promise.resolve()
      yield {
        type: "search-results" as const,
        searches: [
          {
            query: "test query",
            results: [
              {
                title: "First result",
                shortText: "First description",
                link: "https://example.com/first",
              },
              {
                title: "Second result",
                shortText: "Second description",
                link: "https://example.com/second",
              },
            ],
          },
        ],
      }
      yield {
        type: "selected-search-results" as const,
        query: "test query",
        selectedLinks: [
          "https://example.com/first",
          "https://example.com/second",
        ],
      }
      yield {
        type: "page-summary-stream" as const,
        url: "https://example.com/first",
        streamId: "first-summary-stream",
      }
      yield {
        type: "page-summary-stream" as const,
        url: "https://example.com/second",
        streamId: "second-summary-stream",
      }
      yield { type: "done" as const }
    }

    async function* firstSummaryEvents() {
      yield { type: "text" as const, text: "First partial" }
      await firstSummaryGate.promise
      yield { type: "text" as const, text: " summary" }
      yield { type: "done" as const }
    }

    async function* secondSummaryEvents() {
      await Promise.resolve()
      yield { type: "text" as const, text: "Second summary" }
      yield { type: "done" as const }
    }

    mocks.createDeepSearchJob.mockResolvedValue("job-id")
    mocks.subscribeToDeepSearchJob.mockReturnValue(events())
    mocks.subscribeToTextStream.mockImplementation((id: string) => {
      if (id === "first-summary-stream") return firstSummaryEvents()
      if (id === "second-summary-stream") return secondSummaryEvents()
      throw new Error(`Unexpected stream: ${id}`)
    })

    renderDeepSearch()
    fireEvent.change(screen.getByLabelText("Research request"), {
      target: { value: "Research this" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start deep search" }))

    expect(await screen.findByText("Second summary")).toBeInTheDocument()
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "second-summary-stream",
      expect.any(AbortSignal),
      expect.any(Function),
    )

    await act(() => {
      firstSummaryGate.resolve()
      return firstSummaryGate.promise
    })
    expect(await screen.findByText("First partial summary")).toBeInTheDocument()
  })

  it("lists previous jobs as reopenable UUID links", async () => {
    mocks.getDeepSearchJobs.mockResolvedValue([
      {
        ...deepSearchJob(),
        researchRequest: "Previously researched topic",
      },
    ])

    renderDeepSearch()

    expect(
      await screen.findByRole("link", { name: /Previously researched topic/ }),
    ).toHaveAttribute("href", "/deep-search/job-id")
    expect(screen.getByText("Complete")).toBeVisible()
  })

  it("reconnects and replays when a job stream ends before done", async () => {
    mocks.subscribeToDeepSearchJob
      .mockImplementationOnce(async function* () {
        await Promise.resolve()
        yield* []
      })
      .mockImplementationOnce(async function* () {
        await Promise.resolve()
        yield { type: "done" as const }
      })

    renderDeepSearch("/deep-search/job-id")

    expect(
      await screen.findByText(
        "Live updates were interrupted. Reconnecting…",
      ),
    ).toBeVisible()
    await waitFor(() =>
      expect(mocks.subscribeToDeepSearchJob).toHaveBeenCalledTimes(2),
    )
    expect(
      screen.queryByText("Live updates were interrupted. Reconnecting…"),
    ).not.toBeInTheDocument()
  })

  it("renders an explicit resource not-found state", async () => {
    mocks.getDeepSearchJob.mockRejectedValue(
      new ApiError("GET", "/api/deep-search-jobs/missing", 404),
    )

    renderDeepSearch("/deep-search/missing")

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Deep search not found",
      }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/",
    )
  })
})
