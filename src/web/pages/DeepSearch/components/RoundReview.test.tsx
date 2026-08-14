import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ subscribeToTextStream: vi.fn() }))

vi.mock("../../../lib/textStreams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

import { RoundReview } from "./RoundReview.tsx"

describe("RoundReview", () => {
  beforeEach(() => vi.clearAllMocks())

  it("streams review reasoning while the decision is running", async () => {
    async function* events() {
      yield {
        type: "reasoning" as const,
        text: "Checking for a material evidence gap",
      }
      await new Promise(() => {})
    }
    mocks.subscribeToTextStream.mockReturnValue(events())

    render(
      <RoundReview
        review={{ round: 0, streamId: "review-stream", status: "running" }}
      />,
    )

    expect(
      screen.getByRole("heading", {
        level: 4,
        name: "Round 1 research review",
      }),
    ).toBeVisible()
    const reasoningToggle = await screen.findByRole("button", {
      name: "Show reasoning",
    })
    fireEvent.click(reasoningToggle)
    expect(
      screen.getByText("Checking for a material evidence gap"),
    ).toBeVisible()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it.each([
    [
      "continue" as const,
      "More research requested. An independent source is still missing.",
    ],
    [
      "stop" as const,
      "Research is sufficient. The evidence answers every requested angle.",
    ],
  ])("renders the %s decision and reason", (status, expected) => {
    render(
      <RoundReview
        review={{
          round: 0,
          status,
          reason:
            status === "continue"
              ? "An independent source is still missing."
              : "The evidence answers every requested angle.",
        }}
      />,
    )

    expect(
      screen.getByRole("heading", {
        level: 4,
        name: "Round 1 research review",
      }),
    ).toBeVisible()
    expect(screen.getByRole("alert")).toHaveTextContent(expected)
    expect(mocks.subscribeToTextStream).not.toHaveBeenCalled()
  })

  it("explains the non-fatal fallback when review setup fails", () => {
    render(
      <RoundReview
        review={{
          round: 0,
          status: "error",
          reason: "The reviewer returned malformed output.",
        }}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Review failed; using the current answer. The reviewer returned malformed output.",
    )
    expect(mocks.subscribeToTextStream).not.toHaveBeenCalled()
  })
})
