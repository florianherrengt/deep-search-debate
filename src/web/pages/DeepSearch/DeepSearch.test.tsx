import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createDeepSearchJob: vi.fn(),
  subscribeToDeepSearchJob: vi.fn(),
  subscribeToTextStream: vi.fn(),
}))

vi.mock("../../lib/deepSearchJobs.ts", () => ({
  createDeepSearchJob: mocks.createDeepSearchJob,
  subscribeToDeepSearchJob: mocks.subscribeToDeepSearchJob,
}))

vi.mock("../../lib/textStreams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

import { DeepSearch } from "./index.tsx"

describe("DeepSearch", () => {
  beforeEach(() => vi.clearAllMocks())

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
      yield { type: "done" as const }
    }
    async function* queryEvents() {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Prioritizing queries" }
      yield { type: "text" as const, text: "first query\n" }
      yield { type: "text" as const, text: "second query" }
      yield { type: "done" as const }
    }
    async function* selectionEvents() {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Comparing source " }
      yield { type: "reasoning" as const, text: "relevance" }
      yield { type: "text" as const, text: '["result-' }
      yield { type: "text" as const, text: '0"]' }
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
    mocks.createDeepSearchJob.mockResolvedValue("job-id")
    mocks.subscribeToDeepSearchJob.mockReturnValue(events())
    mocks.subscribeToTextStream.mockImplementation((id: string) => {
      if (id === "query-stream-id") return queryEvents()
      if (id === "selection-stream-id") return selectionEvents()
      if (id === "summary-stream-id") return summaryEvents()
      if (id === "query-summary-stream-id") return querySummaryEvents()
      throw new Error(`Unexpected stream: ${id}`)
    })

    render(<DeepSearch />)
    fireEvent.change(screen.getByLabelText("Research request"), {
      target: { value: "Research this" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start deep search" }))

    expect(await screen.findByText("Useful result")).toBeInTheDocument()
    expect(await screen.findByTestId("generated-queries")).toHaveTextContent(
      "first query second query",
    )
    expect(screen.getByText("A useful description")).toBeInTheDocument()
    expect(
      await screen.findByTestId("selection-stream-test query"),
    ).toHaveTextContent('["result-0"]')
    expect(screen.getByText("Job: job-id")).toBeInTheDocument()

    const generatedQueries = screen.getByRole("button", {
      name: "Generated search queries",
    })
    const searchResults = screen.getByRole("button", {
      name: "Results for test query",
    })
    expect(generatedQueries).toHaveAttribute("aria-expanded", "false")
    expect(searchResults).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(generatedQueries)
    fireEvent.click(searchResults)
    expect(generatedQueries).toHaveAttribute("aria-expanded", "true")
    expect(searchResults).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Prioritizing queries")).toBeVisible()
    expect(screen.getByText("Selection output")).toBeVisible()
    expect(screen.getByText("Comparing source relevance")).toBeVisible()
    expect(screen.getByText("Finding relevant facts")).toBeVisible()
    expect(await screen.findByText("A relevant page summary")).toBeVisible()
    expect(screen.getByText("Combining all results")).toBeVisible()
    expect(screen.getByTestId("query-summary-test query")).toHaveTextContent(
      "The search found useful evidence.",
    )
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
      expect.any(AbortSignal),
    )
    expect(mocks.subscribeToDeepSearchJob).toHaveBeenCalledWith(
      "job-id",
      expect.any(AbortSignal),
    )
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "query-stream-id",
      expect.any(AbortSignal),
    )
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "selection-stream-id",
      expect.any(AbortSignal),
    )
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "summary-stream-id",
      expect.any(AbortSignal),
    )
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "query-summary-stream-id",
      expect.any(AbortSignal),
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

    render(<DeepSearch />)
    fireEvent.change(screen.getByLabelText("Research request"), {
      target: { value: "Research this" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start deep search" }))

    expect(await screen.findByText("Second summary")).toBeInTheDocument()
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "second-summary-stream",
      expect.any(AbortSignal),
    )

    await act(() => {
      firstSummaryGate.resolve()
      return firstSummaryGate.promise
    })
    expect(await screen.findByText("First partial summary")).toBeInTheDocument()
  })
})
