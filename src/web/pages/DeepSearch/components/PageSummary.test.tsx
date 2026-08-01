import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ subscribeToTextStream: vi.fn() }))

vi.mock("../../../lib/textStreams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

import { PageSummary } from "./PageSummary.tsx"

describe("PageSummary", () => {
  beforeEach(() => vi.clearAllMocks())

  it("follows partial summary text through completion", async () => {
    const completion = Promise.withResolvers<void>()
    async function* events() {
      yield { type: "reasoning" as const, text: "Identifying useful details" }
      yield { type: "text" as const, text: "A partial summary" }
      await completion.promise
      yield { type: "text" as const, text: " is complete" }
      yield { type: "done" as const }
    }
    mocks.subscribeToTextStream.mockReturnValue(events())

    render(
      <PageSummary
        summary={{ status: "stream", streamId: "summary-stream-id" }}
      />,
    )

    expect(await screen.findByText("Summarizing source…")).toBeVisible()
    const reasoningToggle = await screen.findByRole("button", {
      name: "Show reasoning",
    })
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByText("Identifying useful details"),
    ).not.toBeInTheDocument()
    fireEvent.click(reasoningToggle)
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Identifying useful details")).toBeVisible()
    expect(screen.getByTestId("page-summary-text")).toHaveTextContent(
      "A partial summary",
    )

    await act(async () => {
      completion.resolve()
      await completion.promise
    })

    expect(await screen.findByText("Source findings")).toBeVisible()
    expect(screen.getByTestId("page-summary-text")).toHaveTextContent(
      "A partial summary is complete",
    )
  })

  it("renders extraction and failure states without opening a stream", () => {
    const { rerender } = render(
      <PageSummary summary={{ status: "extracting" }} />,
    )

    expect(screen.getByText("Extracting page content…")).toBeInTheDocument()

    rerender(
      <PageSummary
        summary={{ status: "error", message: "Extraction failed" }}
      />,
    )

    expect(
      screen.getByText("Source findings unavailable"),
    ).toBeInTheDocument()
    expect(screen.getByText("Extraction failed")).toBeInTheDocument()
    expect(mocks.subscribeToTextStream).not.toHaveBeenCalled()
  })
})
