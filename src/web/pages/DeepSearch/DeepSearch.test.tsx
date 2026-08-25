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
  requestResearchStop: vi.fn(),
  requestResearchResume: vi.fn(),
  subscribeToDeepSearchJob: vi.fn(),
  subscribeToTextStream: vi.fn(),
  updateResultFeedback: vi.fn(),
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

vi.mock("../../lib/researchCancellation.ts", () => ({
  requestResearchStop: mocks.requestResearchStop,
}))

vi.mock("../../lib/researchResumption.ts", () => ({
  requestResearchResume: mocks.requestResearchResume,
}))

vi.mock("../../lib/resultFeedback.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/resultFeedback.ts")>()),
  updateResultFeedback: mocks.updateResultFeedback,
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
            path="/deep-search/:slug"
            element={<DeepSearch />}
          />
          <Route
            path="/deep-search/:slug/rounds/:roundNumber"
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
    title: "Research This",
    slug: "research-this",
    researchRequest: "Research this",
    maxSearches: 3,
    maxResultsPerSearch: 3,
    maxRounds: 3,
    isIndexable: false,
    isPublic: false,
    creditsUsed: null,
    feedback: null,
    canResume: false,
    canStop: false,
    status: "completed" as const,
    stopRequested: false,
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
    mocks.requestResearchStop.mockResolvedValue({
      status: "cancellation-requested",
      cancelRequestedAt: new Date(),
    })
    mocks.requestResearchResume.mockResolvedValue({ status: "running" })
    mocks.updateResultFeedback.mockResolvedValue({
      rating: true,
      hasWrittenFeedback: false,
    })
    mocks.subscribeToDeepSearchJob.mockImplementation(async function* () {
      await Promise.resolve()
      yield { type: "done" as const }
    })
  })

  it("refetches a running detail after done and shows its cost beside feedback", async () => {
    const runningJob = {
      ...deepSearchJob(),
      status: "running",
      completedAt: null,
      feedback: { rating: null, hasWrittenFeedback: false },
    } as const
    mocks.getDeepSearchJob
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValue({
        ...runningJob,
        status: "completed",
        completedAt: new Date(),
        creditsUsed: 321,
      })
    mocks.subscribeToDeepSearchJob.mockImplementation(async function* () {
      await Promise.resolve()
      yield { type: "done" as const }
    })

    renderDeepSearch("/deep-search/research-this")

    const up = await screen.findByRole("button", { name: "Thumbs up" })
    expect(screen.getByText("321 credits")).toBeVisible()
    await waitFor(() =>
      expect(mocks.getDeepSearchJob).toHaveBeenCalledTimes(2),
    )
    expect(up).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(up)

    await waitFor(() => expect(up).toHaveAttribute("aria-pressed", "true"))
    expect(mocks.updateResultFeedback).toHaveBeenCalledWith(
      "deep-search",
      "job-id",
      { type: "rating", rating: true },
    )
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

  it("stops an owned root and removes the duplicate action after acceptance", async () => {
    mocks.getDeepSearchJob.mockResolvedValue({
      ...deepSearchJob(),
      canStop: true,
      completedAt: null,
      status: "running",
    })
    mocks.subscribeToDeepSearchJob.mockImplementation(async function* (
      _jobId: string,
      signal: AbortSignal,
    ) {
      yield {
        type: "query-stream" as const,
        round: 0,
        streamId: "pending-query",
      }
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      )
    })
    renderDeepSearch("/deep-search/research-this")

    fireEvent.click(
      await screen.findByRole("button", { name: "Stop workflow" }),
    )
    const dialog = screen.getByRole("dialog", { name: "Stop this workflow?" })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Stop workflow" }),
    )

    await waitFor(() =>
      expect(mocks.requestResearchStop).toHaveBeenCalledWith(
        "deep-search",
        "job-id",
        undefined,
      ),
    )
    expect(
      await screen.findByRole("button", { name: "Stopping…" }),
    ).toBeDisabled()
  })

  it.each(["failed", "interrupted"] as const)(
    "resumes a %s root and reconnects the same job stream",
    async (status) => {
      mocks.getDeepSearchJob.mockResolvedValue({
        ...deepSearchJob(),
        canResume: true,
        error: "Research stopped unexpectedly",
        status,
      })
      mocks.subscribeToDeepSearchJob
        .mockImplementationOnce(async function* () {
          await Promise.resolve()
          yield {
            type:
              status === "failed"
                ? ("error" as const)
                : ("interrupted" as const),
            message: "Research stopped unexpectedly",
          }
          yield { type: "done" as const }
        })
        .mockImplementationOnce(async function* (
          _jobId: string,
          signal?: AbortSignal,
        ) {
          yield {
            type: "query-stream" as const,
            round: 0,
            streamId: "resumed-query",
          }
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve()
            else
              signal?.addEventListener("abort", () => resolve(), {
                once: true,
              })
          })
        })

      renderDeepSearch("/deep-search/research-this")

      fireEvent.click(
        await screen.findByRole("button", { name: "Resume workflow" }),
      )

      await waitFor(() =>
        expect(mocks.requestResearchResume).toHaveBeenCalledWith(
          "deep-search",
          "job-id",
        ),
      )
      await waitFor(() =>
        expect(mocks.subscribeToDeepSearchJob).toHaveBeenCalledTimes(2),
      )
      expect(mocks.subscribeToDeepSearchJob).toHaveBeenLastCalledWith(
        "job-id",
        expect.any(AbortSignal),
        expect.any(Function),
      )
      expect(
        screen.queryByRole("button", { name: "Resume workflow" }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Stop workflow" }),
      ).toBeEnabled()
      expect(await screen.findByRole("status")).toBeVisible()
    },
  )

  it("keeps the failed presentation available when Resume is rejected", async () => {
    mocks.getDeepSearchJob.mockResolvedValue({
      ...deepSearchJob(),
      canResume: true,
      error: "Research stopped unexpectedly",
      status: "failed",
    })
    mocks.requestResearchResume.mockRejectedValue(new Error("Resume failed"))
    mocks.subscribeToDeepSearchJob.mockImplementation(async function* () {
      await Promise.resolve()
      yield { type: "error" as const, message: "Research stopped unexpectedly" }
      yield { type: "done" as const }
    })

    renderDeepSearch("/deep-search/research-this")

    fireEvent.click(
      await screen.findByRole("button", { name: "Resume workflow" }),
    )

    expect(
      await screen.findByText(
        "Could not connect to the server. Check your connection and try again.",
      ),
    ).toBeVisible()
    expect(
      screen.getByText("Research stopped before a final answer was produced."),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Resume workflow" }),
    ).toBeEnabled()
    expect(mocks.subscribeToDeepSearchJob).toHaveBeenCalledOnce()
  })

  it("keeps Resume off nested round routes", async () => {
    mocks.getDeepSearchJob.mockResolvedValue({
      ...deepSearchJob(),
      canResume: true,
      error: "Research stopped unexpectedly",
      status: "failed",
    })

    renderDeepSearch("/deep-search/research-this/rounds/1")

    await waitFor(() => expect(mocks.getDeepSearchJob).toHaveBeenCalled())
    expect(
      screen.queryByRole("button", { name: "Resume workflow" }),
    ).not.toBeInTheDocument()
  })

  it.each([
    [false, true],
    [true, false],
  ] as const)(
    "restores durable stopping for isPublic=%s with ownerControl=%s",
    async (isPublic, ownerControl) => {
      mocks.getDeepSearchJob.mockResolvedValue({
        ...deepSearchJob(),
        canStop: false,
        completedAt: null,
        isPublic,
        status: "running",
        stopRequested: true,
      })
      mocks.subscribeToDeepSearchJob.mockImplementation(async function* (
        _jobId: string,
        signal: AbortSignal,
      ) {
        yield { type: "stop-requested" as const }
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener("abort", () => resolve(), { once: true })
        })
      })

      renderDeepSearch("/deep-search/research-this")

      expect(await screen.findByText(/Stopping research/)).toBeVisible()
      const stoppingControls = screen.queryAllByRole("button", {
        name: "Stopping…",
      })
      expect(stoppingControls).toHaveLength(ownerControl ? 1 : 0)
      expect(
        stoppingControls.every((control) => control.hasAttribute("disabled")),
      ).toBe(true)
    },
  )

  it("creates a job, subscribes, and displays search results", async () => {
    async function* events() {
      await Promise.resolve()
      yield {
        type: "query-stream" as const,
        round: 0,
        streamId: "query-stream-id",
      }
      yield {
        type: "search-results" as const,
        round: 0,
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
        round: 0,
        query: "test query",
        streamId: "selection-stream-id",
      }
      yield {
        type: "selected-search-results" as const,
        round: 0,
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
        round: 0,
        query: "test query",
        streamId: "query-summary-stream-id",
      }
      yield {
        type: "round-answer-stream" as const,
        round: 0,
        streamId: "final-answer-stream-id",
      }
      yield {
        type: "final-answer-stream" as const,
        streamId: "final-answer-stream-id",
      }
      yield {
        type: "research-analysis" as const,
        analysis: {
          facts: [
            {
              title: "Useful evidence was found",
              description: "The explored source supports the final answer.",
              sources: ["https://example.com/result"],
            },
          ],
          disagreements: [],
          gaps: [],
          assumptions: [],
        },
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
    mocks.createDeepSearchJob.mockResolvedValue({
      deepSearchJobId: "job-id",
      slug: "research-this",
    })
    mocks.subscribeToDeepSearchJob.mockImplementation(() => events())
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

    const roundLink = await screen.findByRole("link", { name: /Round 1/ })
    expect(screen.getByTestId("final-answer")).toBeVisible()
    expect(
      screen.getByRole("heading", { name: "Research analysis" }),
    ).toBeVisible()
    expect(screen.getByText("Useful evidence was found")).toBeVisible()
    expect(roundLink).toHaveAttribute(
      "href",
      "/deep-search/research-this/rounds/1",
    )
    expect(screen.queryByText("test query")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Research results" }),
    ).not.toBeInTheDocument()
    fireEvent.click(roundLink)

    await screen.findByText("Complete")
    expect(
      screen.getByRole("heading", { level: 1, name: "Round 1" }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "Back to research" })).toHaveAttribute(
      "href",
      "/deep-search/research-this",
    )

    const sourceSelectionList = await screen.findByTestId(
      "selection-test query",
    )
    expect(within(sourceSelectionList).getByText("Useful result")).toBeVisible()
    expect(screen.getByText("A useful description")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Research results" }),
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "test query" })).toBeVisible()
    expect(screen.getByText("2 results")).toBeVisible()
    expect(screen.getByText("1 explored in depth")).toBeVisible()
    expect(screen.queryByLabelText("Research request")).not.toBeInTheDocument()
    expect(screen.queryByText("Job: job-id")).not.toBeInTheDocument()

    const sourceSelection = screen
      .getByText("Source selection")
      .closest(".MuiPaper-root")
    if (!(sourceSelection instanceof HTMLElement)) {
      throw new Error("Source selection was not rendered")
    }
    expect(within(sourceSelection).getByText("Useful result")).toBeVisible()
    expect(within(sourceSelection).queryByText("result-0")).not.toBeInTheDocument()

    const reasoningSections = [
      {
        container: screen
          .getByText("Source selection")
          .closest(".MuiPaper-root"),
        reasoning: "Comparing source relevance",
      },
      {
        container: (await screen.findByText("What this search found")).closest(
          "section",
        ),
        reasoning: "Combining all results",
      },
      {
        container: screen
          .getByText("Candidate answer")
          .closest(".MuiPaper-root"),
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
    const selectedSource = screen
      .getByRole("link", { name: "Useful result" })
      .closest('[data-selected="true"]')
    if (!(selectedSource instanceof HTMLElement)) {
      throw new Error("Selected source was not rendered")
    }
    const sourceReasoningToggle = await within(selectedSource).findByRole(
      "button",
      { name: "Show reasoning" },
    )
    fireEvent.click(sourceReasoningToggle)
    expect(screen.getByText("Finding relevant facts")).toBeVisible()
    expect(await screen.findByText("A relevant page summary")).toBeVisible()
    expect(screen.getByTestId("query-summary-test query")).toHaveTextContent(
      "The search found useful evidence.",
    )
    expect(screen.getByTestId("round-answer-0")).toHaveTextContent(
      "The final researched answer.",
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
    expect(mocks.subscribeToTextStream).not.toHaveBeenCalledWith(
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
        round: 0,
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
        round: 0,
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

    mocks.createDeepSearchJob.mockResolvedValue({
      deepSearchJobId: "job-id",
      slug: "research-this",
    })
    mocks.subscribeToDeepSearchJob.mockImplementation(() => events())
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

    fireEvent.click(await screen.findByRole("link", { name: /Round 1/ }))

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

  it("lists previous jobs by title with readable links", async () => {
    mocks.getDeepSearchJobs.mockResolvedValue([
      {
        ...deepSearchJob(),
        origin: null,
        researchRequest: "Previously researched topic",
      },
    ])

    renderDeepSearch()

    expect(
      await screen.findByRole("link", { name: /Research This/ }),
    ).toHaveAttribute("href", "/deep-search/research-this")
    expect(screen.getByText("Complete")).toBeVisible()
  })

  it("does not reuse a source-list cache entry for a job with the same slug", async () => {
    mocks.getDeepSearchJobs.mockResolvedValue([
      {
        ...deepSearchJob(),
        origin: null,
        slug: "manual",
      },
    ])
    mocks.getDeepSearchJob.mockImplementation(() => new Promise(() => {}))

    renderDeepSearch()

    fireEvent.click(
      await screen.findByRole("link", { name: /Research This/ }),
    )

    expect(await screen.findByRole("progressbar")).toBeVisible()
    expect(mocks.getDeepSearchJob).toHaveBeenCalledWith(
      "manual",
      expect.any(AbortSignal),
    )
  })

  it("switches between My Searches and Automated with origin links", async () => {
    mocks.getDeepSearchJobs.mockImplementation((source: string) => {
      if (source === "automated") {
        return Promise.resolve([
          {
            ...deepSearchJob(),
            deepSearchJobId: "automated-job-id",
            title: "Automated Search",
            slug: "automated-search",
            researchRequest: "Research for a debate",
            origin: {
              kind: "debate" as const,
              title: "Debate Title",
              slug: "debate-title",
            },
          },
          {
            ...deepSearchJob(),
            deepSearchJobId: "idea-child-id",
            slug: "idea-child-search",
            title: "Idea Child Search",
            researchRequest: "Research for an idea",
            origin: {
              kind: "idea" as const,
              title: "Idea Title",
              slug: "idea-title",
            },
          },
        ])
      }
      return Promise.resolve([
        { ...deepSearchJob(), researchRequest: "Manual research" },
      ])
    })

    renderDeepSearch()

    expect(mocks.getDeepSearchJobs).toHaveBeenCalledWith(
      "manual",
      expect.any(AbortSignal),
    )
    expect(
      await screen.findByRole("link", { name: /Research This/ }),
    ).toHaveAttribute("href", "/deep-search/research-this")
    expect(screen.getByText("Manual research")).toBeVisible()

    fireEvent.click(screen.getByRole("tab", { name: "Automated" }))

    expect(screen.getByRole("tab", { name: "Automated" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    const debateOriginLink = await screen.findByRole("link", {
      name: "From debate: Debate Title",
    })
    expect(debateOriginLink).toHaveAttribute("href", "/debates/debate-title")
    expect(
      screen.getByRole("link", { name: "From idea: Idea Title" }),
    ).toHaveAttribute("href", "/ideas/idea-title")
    const automatedJobLink = screen.getByRole("link", {
      name: /Automated Search/,
    })
    expect(automatedJobLink).toHaveAttribute(
      "href",
      "/deep-search/automated-search",
    )
    expect(automatedJobLink).not.toContainElement(debateOriginLink)
    expect(mocks.getDeepSearchJobs).toHaveBeenCalledWith(
      "automated",
      expect.any(AbortSignal),
    )
    expect(screen.queryByText("Manual research")).not.toBeInTheDocument()
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

  it("shows the non-fatal fallback when round review fails", async () => {
    mocks.subscribeToDeepSearchJob.mockImplementation(async function* () {
      await Promise.resolve()
      yield {
        type: "round-review-error" as const,
        round: 0,
        message: "Review unavailable",
      }
      yield { type: "done" as const }
    })

    renderDeepSearch("/deep-search/research-this")

    const round = await screen.findByRole("link", { name: /Round 1/ })
    expect(within(round).getByText("Review unavailable")).toBeVisible()

    fireEvent.click(round)
    expect(
      screen.getByText(
        "Review failed; using the current answer. Review unavailable",
      ),
    ).toBeVisible()
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

  it("only indexes a completed deep search inherited from a public debate", async () => {
    mocks.getDeepSearchJob.mockResolvedValue({
      ...deepSearchJob(),
      isIndexable: true,
      isPublic: true,
    })

    renderDeepSearch("/deep-search/research-this")

    await screen.findByText("Research This")
    await waitFor(() =>
      expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
        "content",
        "index, follow",
      ),
    )
    expect(document.head.querySelector('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "article",
    )
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://rethinkloop.com/deep-search/research-this",
    )
  })

  it("preserves matching server metadata while a direct round route loads", () => {
    mocks.getDeepSearchJob.mockImplementation(() => new Promise(() => {}))
    document.documentElement.dataset.seoPage =
      "/deep-search/research-this/rounds/1"
    document.title = "Server-rendered research title"
    const canonical = document.createElement("link")
    canonical.rel = "canonical"
    canonical.href = "https://rethinkloop.com/deep-search/research-this"
    document.head.querySelector('link[rel="canonical"]')?.remove()
    document.head.appendChild(canonical)

    renderDeepSearch("/deep-search/research-this/rounds/1")

    expect(document.title).toBe("Server-rendered research title")
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://rethinkloop.com/deep-search/research-this",
    )
  })

  it("uses the round page key while retaining the public parent canonical", async () => {
    mocks.getDeepSearchJob.mockResolvedValue({
      ...deepSearchJob(),
      isIndexable: true,
      isPublic: true,
    })
    mocks.subscribeToDeepSearchJob.mockImplementation(async function* () {
      await Promise.resolve()
      yield {
        type: "query-stream" as const,
        round: 0,
        streamId: "query-stream",
      }
      yield { type: "done" as const }
    })

    renderDeepSearch("/deep-search/research-this/rounds/1")

    await screen.findByText("Complete")
    expect(
      screen.getByRole("heading", { level: 1, name: "Round 1" }),
    ).toBeVisible()
    await waitFor(() =>
      expect(document.documentElement.dataset.seoPage).toBe(
        "/deep-search/research-this/rounds/1",
      ),
    )
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "index, follow",
    )
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://rethinkloop.com/deep-search/research-this",
    )
  })

  it("removes parent metadata when a round is absent after replay", async () => {
    mocks.getDeepSearchJob.mockResolvedValue({
      ...deepSearchJob(),
      isIndexable: true,
      isPublic: true,
    })

    renderDeepSearch("/deep-search/research-this/rounds/2")

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Round not found",
      }),
    ).toBeVisible()
    await waitFor(() =>
      expect(document.head.querySelector('link[rel="canonical"]')).toBeNull(),
    )
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    )
    expect(document.documentElement.dataset.seoPage).toBe(
      "/deep-search/research-this/rounds/2",
    )
  })
})
