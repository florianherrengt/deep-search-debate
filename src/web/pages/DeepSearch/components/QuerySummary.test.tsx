import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ subscribeToTextStream: vi.fn() }))

vi.mock("../../../lib/textStreams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

import { QuerySummary } from "./QuerySummary.tsx"

describe("QuerySummary", () => {
  beforeEach(() => vi.clearAllMocks())

  it("follows and renders a query synthesis stream", async () => {
    async function* events() {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Combining the findings" }
      yield { type: "text" as const, text: "- First finding\n" }
      yield { type: "text" as const, text: "- Second finding" }
      yield { type: "done" as const }
    }
    mocks.subscribeToTextStream.mockReturnValue(events())

    render(
      <QuerySummary
        query="best beginner longboards"
        streamId="query-summary-stream-id"
      />,
    )

    expect(await screen.findByText("What this search found")).toBeVisible()
    const reasoningToggle = await screen.findByRole("button", {
      name: "Show reasoning",
    })
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Combining the findings")).not.toBeInTheDocument()
    fireEvent.click(reasoningToggle)
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Combining the findings")).toBeVisible()
    expect(
      screen.getByTestId("query-summary-best beginner longboards"),
    ).toHaveTextContent("- First finding - Second finding")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "query-summary-stream-id",
      expect.any(AbortSignal),
      expect.any(Function),
    )
  })

  it("renders nothing before a synthesis stream is registered", () => {
    const { container } = render(
      <QuerySummary query="best beginner longboards" />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(mocks.subscribeToTextStream).not.toHaveBeenCalled()
  })
})
