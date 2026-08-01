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
    expect(screen.getByText("A useful description")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Research results" }),
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "test query" })).toBeVisible()
    expect(screen.getByText("2 results")).toBeVisible()
    expect(screen.getByText("1 explored in depth")).toBeVisible()
    expect(screen.queryByLabelText("Research request")).not.toBeInTheDocument()
    expect(screen.queryByText("Job: job-id")).not.toBeInTheDocument()
    expect(screen.queryByText("Prioritizing queries")).not.toBeInTheDocument()
    expect(screen.queryByText("Selection output")).not.toBeInTheDocument()
    expect(
      screen.queryByText("Comparing source relevance"),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("Finding relevant facts"),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("Combining all results"),
    ).not.toBeInTheDocument()

    const sourceResults = screen.getByRole("button", {
      name: "Show source results for test query",
    })
    expect(sourceResults).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(sourceResults)
    expect(sourceResults).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByText("A relevant page summary")).toBeVisible()
    expect(screen.getByTestId("query-summary-test query")).toHaveTextContent(
      "The search found useful evidence.",
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
      expect.any(AbortSignal),
    )
    expect(mocks.subscribeToDeepSearchJob).toHaveBeenCalledWith(
      "job-id",
      expect.any(AbortSignal),
    )
    expect(mocks.subscribeToTextStream).not.toHaveBeenCalledWith(
      "query-stream-id",
      expect.any(AbortSignal),
    )
    expect(mocks.subscribeToTextStream).not.toHaveBeenCalledWith(
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
